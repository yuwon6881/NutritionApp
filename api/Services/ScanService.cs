using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;
public record ScanInput(Guid Id,string Mode,string Description,string? ImageBase64);
public sealed class ScanService(AppDb db,TemporaryImageStore images,NutritionAi ai,StorageService storage)
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
        var uploadRequired=false;
        await using(var gate=await MutationLock.Acquire(db,null,ct))
        {
            var duplicate=await db.Scans.SingleOrDefaultAsync(s=>s.Id==input.Id,ct);
            if(duplicate!=null)
            {
                Validation.Require(duplicate.RequestHash==hash,"Scan identity was reused.",409);
                if(!CanRetryExistingUpload(duplicate,hash,bytes!=null))return duplicate;
                if(bytes!=null)await storage.AllowOptional(ct);
                duplicate.Status=bytes==null?"queued":"uploading";
                duplicate.Error=null;
                duplicate.ResultJson=null;
                duplicate.LeaseUntil=null;
                duplicate.ObjectPath=bytes==null?null:$"nutrition-scans/{db.CurrentUser}/{input.Id}.jpg";
                await db.SaveChangesAsync(ct);
                await gate.Commit(ct);
                scan=duplicate;
                uploadRequired=bytes!=null;
            }
            else
            {
                await storage.AllowOptional(ct);
                Validation.Require(await db.Scans.CountAsync(s=>s.Created>DateTime.UtcNow.AddDays(-1),ct)<40,"Too many AI requests today.",429);
                scan=new ScanJob { Id=input.Id,UserId=db.CurrentUser!.Value,RequestHash=hash,ImageBytes=bytes?.Length??0,Mode=input.Mode,Description=input.Description,Status=bytes==null?"queued":"uploading",ObjectPath=bytes==null?null:$"nutrition-scans/{db.CurrentUser}/{input.Id}.jpg" };
                db.Scans.Add(scan); await db.SaveChangesAsync(ct); await gate.Commit(ct);
                uploadRequired=bytes!=null;
            }
        }
        if(bytes!=null&&uploadRequired)
        {
            try { await images.Put(scan.ObjectPath!,bytes,ct); scan.Status="queued"; }
            catch { scan.Status="failed";scan.Error="Upload interrupted. Try again."; }
            await db.SaveChangesAsync(CancellationToken.None);
        }
        return scan;
    }

    internal static bool CanRetryExistingUpload(ScanJob scan,string requestHash,bool hasImage)=>
        scan.RequestHash==requestHash&&hasImage&&scan.ImageBytes>0&&
        (scan.Status=="uploading"||(scan.Status=="failed"&&scan.Error=="Upload interrupted. Try again."));

    public async Task<ScanJob> Process(Guid id,CancellationToken ct)
    {
        ScanJob scan; DateOnly usageDay;
        var lease=DateTime.UtcNow.AddMinutes(3);
        await using(var gate=await MutationLock.Acquire(db,null,ct))
        {
            scan=await db.Scans.SingleOrDefaultAsync(s=>s.Id==id,ct)??throw new DomainException("Scan not found.",404);
            if(scan.Status is "complete" or "failed" or "uploading"||scan.LeaseUntil>DateTime.UtcNow) return scan;
            usageDay=await AiAllowance.ReserveUnderLock(db,ct);
            scan.Status="processing";scan.LeaseUntil=lease;
            await db.SaveChangesAsync(ct); await gate.Commit(ct);
        }
        try
        {
            var bytes=scan.ObjectPath==null?null:await images.Get(scan.ObjectPath,ct);
            var result=await ai.Analyze(scan.Mode,scan.Description,bytes,ct);
            scan.ResultJson=Json.Write(result.Estimate);scan.Status="complete";scan.Error=null;
            await AiAllowance.RecordTokens(db,usageDay,result.InputTokens,result.CachedInputTokens,result.OutputTokens);
        }
        catch(Exception ex) when(ex is DomainException or HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or FormatException or InvalidOperationException or KeyNotFoundException)
        { scan.Status="failed";scan.Error=ex is DomainException?ex.Message:"AI processing was interrupted. Try again."; }
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
