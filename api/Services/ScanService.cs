using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;
public record ScanInput(Guid Id,string Mode,string Description,string? ImageBase64);
public sealed class ScanService(AppDb db,TemporaryImageStore images,NutritionAi ai,StorageService storage,IConfiguration config)
{
    public async Task<ScanJob> Create(ScanInput input,CancellationToken ct)
    {
        Validation.Require(input.Id!=Guid.Empty&&input.Mode is "photo" or "label" or "description","Invalid scan.");
        Validation.Require(input.Description.Length<=3000,"Description is too long.");
        Validation.Require(input.Mode!="description"||!string.IsNullOrWhiteSpace(input.Description),"Describe your meal.");
        byte[]? bytes=null;
        if(input.ImageBase64!=null)
        {
            Validation.Require(input.ImageBase64.Length<=2_000_000,"Photo is too large.");
            try { bytes=Convert.FromBase64String(input.ImageBase64); } catch { throw new DomainException("Invalid image."); }
            Validation.Require(bytes.Length>3&&bytes[0]==0xff&&bytes[1]==0xd8&&bytes[2]==0xff,"Use a processed JPEG photo.");
        }
        Validation.Require(input.Mode=="description"||bytes!=null,"Choose a photo first.");
        var hash=AuthService.Hash(Json.Write(input));
        ScanJob scan;
        await using(var gate=await MutationLock.Acquire(db,null,ct))
        {
            var duplicate=await db.Scans.SingleOrDefaultAsync(s=>s.Id==input.Id,ct);
            if(duplicate!=null) { Validation.Require(duplicate.RequestHash==hash,"Scan identity was reused.",409); return duplicate; }
            await storage.AllowOptional(ct);
            Validation.Require(await db.Scans.CountAsync(s=>s.Created>DateTime.UtcNow.AddDays(-1),ct)<40,"Too many scan drafts today.",429);
            scan=new ScanJob { Id=input.Id,UserId=db.CurrentUser!.Value,RequestHash=hash,ImageBytes=bytes?.Length??0,Mode=input.Mode,Description=input.Description,Status=bytes==null?"queued":"uploading",ObjectPath=bytes==null?null:$"nutrition-scans/{db.CurrentUser}/{input.Id}.jpg" };
            db.Scans.Add(scan); await db.SaveChangesAsync(ct); await gate.Commit(ct);
        }
        if(bytes!=null)
        {
            try { await images.Put(scan.ObjectPath!,bytes,ct); scan.Status="queued"; }
            catch { scan.Status="failed";scan.Error="Upload interrupted. Resubmit the local photo draft."; }
            await db.SaveChangesAsync(CancellationToken.None);
        }
        return scan;
    }
    public async Task<ScanJob> Process(Guid id,CancellationToken ct)
    {
        ScanJob scan; AiUsage usage;
        var lease=DateTime.UtcNow.AddMinutes(3);
        await using(var gate=await MutationLock.Acquire(db,null,ct))
        {
            scan=await db.Scans.SingleOrDefaultAsync(s=>s.Id==id,ct)??throw new DomainException("Scan not found.",404);
            if(scan.Status is "complete" or "failed" or "uploading"||scan.LeaseUntil>DateTime.UtcNow) return scan;
            var day=DateOnly.FromDateTime(DateTime.UtcNow);
            usage=await db.Usage.SingleOrDefaultAsync(u=>u.Date==day,ct)??new AiUsage { UserId=db.CurrentUser!.Value,Date=day };
            Validation.Require(usage.Requests<config.GetValue("OpenAi:DailyRequestsPerUser",20),"Today's AI allowance is used. Manual logging is available.",429);
            var cap=config.GetValue<double?>("OpenAi:MonthlyBudgetUsd");
            if(cap!=null)
            {
                // Reserve worst-case request cost across both users before making a paid call.
                var month=new DateOnly(day.Year,day.Month,1);
                var total=await db.Usage.IgnoreQueryFilters().Where(u=>u.Date>=month).SumAsync(u=>u.Requests,ct);
                Validation.Require((total+1)*config.GetValue("OpenAi:ReservedCostPerRequestUsd",0.25)<=cap,"Monthly AI allowance is used.",429);
            }
            if(db.Entry(usage).State==EntityState.Detached) db.Usage.Add(usage);
            usage.Requests++;scan.Status="processing";scan.LeaseUntil=lease;
            await db.SaveChangesAsync(ct); await gate.Commit(ct);
        }
        try
        {
            var bytes=scan.ObjectPath==null?null:await images.Get(scan.ObjectPath,ct);
            var result=await ai.Analyze(scan.Mode,scan.Description,bytes,ct);
            scan.ResultJson=Json.Write(result.Draft);scan.Status="complete";scan.Error=null;
            await db.Usage.Where(u=>u.Date==usage.Date).ExecuteUpdateAsync(s=>s.SetProperty(u=>u.InputTokens,u=>u.InputTokens+result.InputTokens).SetProperty(u=>u.OutputTokens,u=>u.OutputTokens+result.OutputTokens),CancellationToken.None);
        }
        catch(Exception ex) when(ex is DomainException or HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        { scan.Status="failed";scan.Error=ex is DomainException?ex.Message:"AI processing was interrupted. Resubmit the retained draft."; }
        finally
        {
            scan.LeaseUntil=null;
            await db.SaveChangesAsync(CancellationToken.None);
            if(scan.ObjectPath!=null)
            {
                try { await images.Delete(scan.ObjectPath,CancellationToken.None);scan.ObjectPath=null;await db.SaveChangesAsync(CancellationToken.None); }
                catch(Exception ex) when(ex is DomainException or HttpRequestException or TaskCanceledException) { /* Scheduled cleanup retries the durable object path. */ }
            }
        }
        return scan;
    }
}

