using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
namespace Nutrition.Api.Services;
public record PhotoInput(Guid Id,DateOnly Date,string Caption,string Angle,string ImageBase64);
public record PhotoView(Guid Id,DateOnly Date,string Caption,string Angle,int Bytes,string Status);
public sealed class PhotoService(AppDb db,GcsPhotoStore store,IConfiguration config,StorageService storage)
{
    public async Task<PhotoView> Upload(PhotoInput input,CancellationToken ct)
    {
        Validation.Require(store.Configured,"Physique photo storage is not configured yet.",503);
        Validation.Require(input.Id!=Guid.Empty&&input.Caption.Length<=160&&input.Angle is "front" or "side" or "back" or "other","Invalid photo details.");
        Validation.Require(input.Date>=new DateOnly(2000,1,1)&&input.Date<=DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1),"Choose a valid photo date.");
        Validation.Require(input.ImageBase64.Length<=1_000_000,"Compress the physique photo below 750 KB.");
        byte[] bytes;try{bytes=Convert.FromBase64String(input.ImageBase64);}catch{throw new DomainException("Invalid photo data.");}
        Validation.Require(bytes.Length is >4 and <=750000&&bytes[0]==0xff&&bytes[1]==0xd8&&bytes[^2]==0xff&&bytes[^1]==0xd9,"Upload a processed JPEG photo.");
        var hash=AuthService.Hash(Json.Write(input));PhysiquePhoto photo;
        await using(var gate=await MutationLock.Acquire(db,db.CurrentUser,ct))
        {
            var existing=await db.Photos.SingleOrDefaultAsync(p=>p.Id==input.Id,ct);
            if(existing!=null){Validation.Require(existing.RequestHash==hash&&!existing.Deleted,"Photo identity was reused or deleted.",409);if(existing.Status=="complete")return View(existing);photo=existing;}
            else
            {
                await storage.AllowOptional(ct);
                var total=await db.Photos.Where(p=>!p.Deleted).SumAsync(p=>(long)p.Bytes,ct);
                Validation.Require(total+bytes.Length<=config.GetValue("Physique:MaxBytesPerUser",268435456L),"Your photo storage budget is full. Remove photos or adjust the configured budget.",507);
                photo=new PhysiquePhoto { Id=input.Id,UserId=db.CurrentUser!.Value,Date=input.Date,Caption=input.Caption,Angle=input.Angle,Bytes=bytes.Length,RequestHash=hash,ObjectPath=$"nutrition-physique/{db.CurrentUser}/{input.Id}.jpg" };
                db.Photos.Add(photo);await db.SaveChangesAsync(ct);
            }
            await gate.Commit(ct);
        }
        await using var uploadGate=await MutationLock.Acquire(db,db.CurrentUser,ct);
        await db.Entry(photo).ReloadAsync(ct);
        Validation.Require(!photo.Deleted,"Photo draft expired or was deleted. Create a new draft.",409);
        if(photo.Status=="complete")return View(photo);
        await store.Put(photo.ObjectPath,bytes,ct);
        // A pending upload is reserved in the quota even if the network acknowledgement is lost.
        photo.Status="complete";await db.SaveChangesAsync(ct);await uploadGate.Commit(ct);return View(photo);
    }
    public async Task<byte[]> Content(Guid id,CancellationToken ct)
    {
        var photo=await db.Photos.SingleOrDefaultAsync(p=>p.Id==id&&!p.Deleted&&p.Status=="complete",ct)??throw new DomainException("Photo not found.",404);
        return await store.Get(photo.ObjectPath,ct);
    }
    public async Task Delete(Guid id,CancellationToken ct)
    {
        await using var gate=await MutationLock.Acquire(db,db.CurrentUser,ct);
        var photo=await db.Photos.SingleOrDefaultAsync(p=>p.Id==id,ct)??throw new DomainException("Photo not found.",404);
        photo.Deleted=true;photo.Status="deleting";await db.SaveChangesAsync(ct);await gate.Commit(ct);
        // Keep a deletion marker until GCS confirms deletion; scheduled cleanup retries failures.
        await store.Delete(photo.ObjectPath,ct);photo.Status="deleted";await db.SaveChangesAsync(ct);
    }
    public async Task<int> Cleanup(CancellationToken ct)
    {
        db.MaintenanceAccess=true;var now=DateTime.UtcNow;
        var photos=await db.Photos.IgnoreQueryFilters().Where(p=>p.Status=="deleting"||(p.Status=="uploading"&&p.Created<now.AddDays(-1))).Take(100).ToListAsync(ct);
        var count=0;foreach(var photo in photos)
        {
            await using var gate=await MutationLock.Acquire(db,photo.UserId,ct);
            await db.Entry(photo).ReloadAsync(ct);
            if(photo.Status is "complete" or "deleted")continue;
            try{await store.Delete(photo.ObjectPath,ct);photo.Deleted=true;photo.Status="deleted";await db.SaveChangesAsync(ct);await gate.Commit(ct);count++;}catch(DomainException){/* Retry at next scheduled wake. */}
        }
        await db.SaveChangesAsync(ct);return count;
    }
    public static PhotoView View(PhysiquePhoto photo)=>new(photo.Id,photo.Date,photo.Caption,photo.Angle,photo.Bytes,photo.Status);
}
