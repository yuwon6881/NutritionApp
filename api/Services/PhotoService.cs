using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public record PhotoPart(Guid Id,string Angle,string? ImageBase64);
public record PhotoSetInput(Guid Id,DateOnly Date,IReadOnlyList<PhotoPart> Photos);
public record PhotoView(Guid Id,Guid SetId,DateOnly Date,string Angle,int Bytes,string Status);

public sealed class PhotoService(AppDb db,GcsPhotoStore store,IConfiguration config,StorageService storage)
{
    private static readonly DateOnly EarliestDate=new(2000,1,1);

    public async Task<IReadOnlyList<PhotoView>> Upload(PhotoSetInput input,CancellationToken ct)
    {
        Validation.Require(store.Configured,"Physique photo storage is not configured yet.",503);
        Validation.Require(input.Id!=Guid.Empty,"Photo set identity is required.");
        Validation.Require(input.Date>=EarliestDate&&input.Date<=DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1),"Choose a valid photo date.");
        var parts=input.Photos??Array.Empty<PhotoPart>();
        Validation.Require(parts.Count<=3,"A physique photo set can contain at most three views.");
        Validation.Require(parts.Select(part=>part.Angle).Distinct(StringComparer.Ordinal).Count()==parts.Count&&parts.All(part=>part.Angle is "front" or "side" or "back"),"Choose one front, side, and back photo at most.");
        Validation.Require(parts.All(part=>part.Id!=Guid.Empty),"Photo identity is required.");

        var uid=db.CurrentUser??throw new DomainException("Sign in again.",401);
        var prepared=new List<PreparedPhoto>();
        foreach(var part in parts)
        {
            Validation.Require(!string.IsNullOrWhiteSpace(part.ImageBase64)&&part.ImageBase64.Length<=1_000_000,"Compress the physique photo below 750 KB.");
            byte[] bytes;
            try{bytes=Convert.FromBase64String(part.ImageBase64!);}catch{throw new DomainException("Invalid photo data.");}
            Validation.Require(bytes.Length is >4 and <=750000&&bytes[0]==0xff&&bytes[1]==0xd8&&bytes[^2]==0xff&&bytes[^1]==0xd9,"Upload a processed JPEG photo.");
            prepared.Add(new PreparedPhoto(part,bytes,AuthService.Hash(Json.Write(new {SetId=input.Id,input.Date,PhotoId=part.Id,part.Angle,part.ImageBase64}))));
        }

        var uploads=new List<PendingUpload>();
        await using(var gate=await MutationLock.Acquire(db,uid,ct))
        {
            await storage.AllowOptional(ct);
            var set=await db.Photos.Where(photo=>photo.SetId==input.Id).ToListAsync(ct);
            var partIds=parts.Select(part=>part.Id).ToArray();
            var byId=partIds.Length==0?new Dictionary<Guid,PhysiquePhoto>():await db.Photos.Where(photo=>partIds.Contains(photo.Id)).ToDictionaryAsync(photo=>photo.Id,ct);
            var visibleSet=set.Where(photo=>!photo.Deleted).ToDictionary(photo=>photo.Angle,StringComparer.Ordinal);
            Validation.Require(parts.Count>0||visibleSet.Count>0,"Choose at least one photo before saving.");
            var total=await db.Photos.Where(photo=>!photo.Deleted).SumAsync(photo=>(long)photo.Bytes,ct);

            foreach(var preparedPhoto in prepared)
            {
                var part=preparedPhoto.Part;
                byId.TryGetValue(part.Id,out var photoById);
                var existing=photoById??visibleSet.GetValueOrDefault(part.Angle);
                if(photoById!=null)
                {
                    Validation.Require(!photoById.Deleted&&photoById.SetId==input.Id&&photoById.Angle==part.Angle,"Photo identity was reused by another set.",409);
                    existing=photoById;
                }
                else if(existing!=null)
                {
                    Validation.Require(existing.Id==part.Id,"Keep the existing photo identity when replacing a view.",409);
                }

                var hashMatches=existing!=null&&!existing.Deleted&&existing.RequestHash==preparedPhoto.Hash;
                if(hashMatches&&existing!.Status=="complete")continue;
                var oldBytes=existing is {Deleted:false}?existing.Bytes:0;
                total-=oldBytes;
                total+=preparedPhoto.Bytes.Length;
                Validation.Require(total<=config.GetValue("Physique:MaxBytesPerUser",268435456L),"Your photo storage budget is full. Remove photos or adjust the configured budget.",507);
                if(existing==null)
                {
                    existing=new PhysiquePhoto
                    {
                        Id=part.Id,UserId=uid,SetId=input.Id,Date=input.Date,Angle=part.Angle,
                        Bytes=preparedPhoto.Bytes.Length,RequestHash=preparedPhoto.Hash,
                        ObjectPath=$"nutrition-physique/{uid}/{part.Id}.jpg",Status="uploading"
                    };
                    db.Photos.Add(existing);
                }
                else
                {
                    existing.Date=input.Date;existing.Bytes=preparedPhoto.Bytes.Length;existing.RequestHash=preparedPhoto.Hash;existing.Status="uploading";existing.Deleted=false;
                }
                uploads.Add(new PendingUpload(existing,preparedPhoto.Bytes,preparedPhoto.Hash,photoById!=null));
            }

            foreach(var photo in set.Where(photo=>!photo.Deleted))photo.Date=input.Date;
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }

        if(uploads.Count==0)return await SetViews(input.Id,ct);
        await using var uploadGate=await MutationLock.Acquire(db,uid,ct);
        foreach(var pending in uploads)
        {
            await db.Entry(pending.Photo).ReloadAsync(ct);
            Validation.Require(!pending.Photo.Deleted,"Photo draft expired or was deleted. Create a new draft.",409);
            if(pending.Photo.Status=="complete"&&pending.Photo.RequestHash==pending.Hash)continue;
            await store.Put(pending.Photo.ObjectPath,pending.Bytes,ct,pending.Replace);
            pending.Photo.Status="complete";
        }
        await db.SaveChangesAsync(ct);
        await uploadGate.Commit(ct);
        return await SetViews(input.Id,ct);
    }

    private async Task<IReadOnlyList<PhotoView>> SetViews(Guid setId,CancellationToken ct)
        =>(await db.Photos.Where(photo=>photo.SetId==setId&&!photo.Deleted&&photo.Status=="complete").OrderBy(photo=>photo.Angle).ToListAsync(ct)).Select(View).ToList();

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

    public static PhotoView View(PhysiquePhoto photo)=>new(photo.Id,photo.SetId,photo.Date,photo.Angle,photo.Bytes,photo.Status);

    private sealed record PreparedPhoto(PhotoPart Part,byte[] Bytes,string Hash);
    private sealed record PendingUpload(PhysiquePhoto Photo,byte[] Bytes,string Hash,bool Replace);
}
