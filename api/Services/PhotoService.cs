using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public record PhotoPart(Guid Id,string Angle,string? ImageBase64);
public record PhotoSetInput(Guid Id,DateOnly Date,IReadOnlyList<PhotoPart> Photos,Guid? MutationId=null,long? ExpectedRevision=null);
public record PhotoView(Guid Id,Guid SetId,DateOnly Date,string Angle,int Bytes,string Status);
public record PhotoSetView(Guid Id,DateOnly Date,IReadOnlyList<PhotoView> Photos);
public record PhotoPage(bool Configured,long UsedBytes,long MaxBytes,IReadOnlyList<PhotoSetView> Sets,string? NextCursor,bool HasMore);
public record PhotoLegacyPage(bool Configured,long UsedBytes,long MaxBytes,IReadOnlyList<PhotoView> Photos);

public sealed class PhotoService(AppDb db,GcsPhotoStore store,IConfiguration config,StorageService storage)
{
    private static readonly DateOnly EarliestDate=new(2000,1,1);
    public bool Configured => store.Configured;

    public async Task<PhotoPage> Page(string? cursor,int limit,CancellationToken ct)
    {
        limit=Math.Clamp(limit,1,20);
        var (used,max)=await Totals(ct);
        var grouped=db.Photos.AsNoTracking().Where(photo=>!photo.Deleted&&photo.Status=="complete")
            .GroupBy(photo=>new {photo.SetId,photo.Date})
            .Select(group=>new {group.Key.SetId,group.Key.Date});
        CursorValue? after=null;
        if(!string.IsNullOrWhiteSpace(cursor))
        {
            var decoded=DecodeCursor(cursor!);
            after=new CursorValue(decoded.Date,decoded.SetId);
        }
        var keys=await grouped.Where(key=>after==null||key.Date<after.Date).OrderByDescending(key=>key.Date).ThenByDescending(key=>key.SetId).Take(limit+1).ToListAsync(ct);
        if(after is not null)
        {
            // Guid ordering is intentionally applied after the date predicate,
            // keeping tied dates stable without relying on provider-specific
            // Guid comparison SQL.
            var tied=await grouped.Where(key=>key.Date==after.Date).ToListAsync(ct);
            keys=keys.Concat(tied.Where(key=>key.SetId.CompareTo(after.SetId)<0)).OrderByDescending(key=>key.Date).ThenByDescending(key=>key.SetId).Take(limit+1).ToList();
        }
        var hasMore=keys.Count>limit;
        var pageKeys=keys.Take(limit).ToList();
        var ids=pageKeys.Select(key=>key.SetId).ToArray();
        var photos=ids.Length==0?[]:await db.Photos.AsNoTracking().Where(photo=>ids.Contains(photo.SetId)&&!photo.Deleted&&photo.Status=="complete").OrderBy(photo=>photo.Angle).ToListAsync(ct);
        var sets=pageKeys.Select(key=>new PhotoSetView(key.SetId,key.Date,photos.Where(photo=>photo.SetId==key.SetId).Select(View).ToList())).ToList();
        var next=hasMore&&pageKeys.Count>0?EncodeCursor(pageKeys[^1].Date,pageKeys[^1].SetId):null;
        return new PhotoPage(store.Configured,used,max,sets,next,hasMore);
    }

    public async Task<PhotoLegacyPage> LegacyPage(int skip,CancellationToken ct)
    {
        var (used,max)=await Totals(ct);
        var photos=(await db.Photos.AsNoTracking().Where(photo=>!photo.Deleted&&photo.Status=="complete").OrderByDescending(photo=>photo.Date).ThenBy(photo=>photo.Id).Skip(Math.Clamp(skip,0,100000)).Take(24).ToListAsync(ct)).Select(View).ToList();
        return new PhotoLegacyPage(store.Configured,used,max,photos);
    }

    private async Task<(long UsedBytes,long MaxBytes)> Totals(CancellationToken ct)
        => (await db.Photos.Where(photo=>!photo.Deleted).SumAsync(photo=>(long)photo.Bytes,ct),config.GetValue("Physique:MaxBytesPerUser",268435456L));

    public static string EncodeCursor(DateOnly date,Guid setId)
        =>Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"{date:yyyy-MM-dd}|{setId:D}"))
            .TrimEnd('=').Replace('+','-').Replace('/','_');

    public static (DateOnly Date,Guid SetId) DecodeCursor(string value)
    {
        try
        {
            var padded=value.Replace('-','+').Replace('_','/');
            padded+=new string('=',(4-padded.Length%4)%4);
            var parts=System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(padded)).Split('|',2);
            var date=default(DateOnly);var id=default(Guid);
            var validDate=parts.Length==2&&DateOnly.TryParseExact(parts[0],"yyyy-MM-dd",out date);
            var validId=parts.Length==2&&Guid.TryParse(parts[1],out id);
            Validation.Require(validDate&&validId,"Photo cursor is invalid.");
            return (date,id);
        }
        catch(DomainException){throw;}
        catch{throw new DomainException("Photo cursor is invalid.");}
    }

    public async Task<IReadOnlyList<PhotoView>> Upload(PhotoSetInput input,CancellationToken ct)
    {
        Validation.Require(store.Configured,"Physique photo storage is not configured yet.",503);
        Validation.Require(input.Id!=Guid.Empty,"Photo set identity is required.");
        Validation.Require(input.Date>=EarliestDate&&input.Date<=DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1),"Choose a valid photo date.");
        var parts=input.Photos??Array.Empty<PhotoPart>();
        Validation.Require(parts.Count<=3,"A physique photo set can contain at most three views.");
        Validation.Require(parts.Select(part=>part.Angle).Distinct(StringComparer.Ordinal).Count()==parts.Count&&parts.All(part=>part.Angle is "front" or "side" or "back"),"Choose one front, side, and back photo at most.");
        Validation.Require(parts.All(part=>part.Id!=Guid.Empty),"Photo identity is required.");
        Validation.Require(parts.Select(part=>part.Id).Distinct().Count()==parts.Count,"Each photo needs its own identity.");
        Validation.Require((input.MutationId==null)==(input.ExpectedRevision==null)&&input.MutationId!=Guid.Empty,"Photo mutation identity and revision must be supplied together.");

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
            var body=await BodyRecordService.EnsureLegacyUnderLock(db,input.Id,input.Date,ct);
            var dateChanged=body.Date!=input.Date;
            var user=await db.Users.SingleAsync(u=>u.Id==uid,ct);
            var requestHash=AuthService.Hash(Json.Write(new {kind="body-photos",input}));
            var receipt=input.MutationId is {} mutationId?await db.Receipts.SingleOrDefaultAsync(r=>r.Id==mutationId,ct):null;
            if(receipt!=null)Validation.Require(receipt.Hash==requestHash,"Idempotency key reused for different photos.",409);
            else if(input.ExpectedRevision is {} expected)Validation.Require(body.Revision==expected,"This Body record changed on another device. Review the conflict.",409);
            // A replay must not move a corrected date back or revive deleted photos.
            if(receipt==null)
            {
                if(input.ExpectedRevision!=null)Validation.Require(body.Date==input.Date,"The Body record date changed. Review before uploading.",409);
                else body.Date=input.Date;
            }
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

                if(receipt!=null)Validation.Require(existing!=null&&existing.RequestHash==preparedPhoto.Hash,"This photo mutation was superseded. Review before retrying.",409);

                var hashMatches=existing!=null&&!existing.Deleted&&existing.RequestHash==preparedPhoto.Hash;
                if(hashMatches&&existing!.Status=="complete")continue;
                var expectedGeneration=existing?.ObjectGeneration;
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
                    existing.Date=input.Date;existing.Bytes=preparedPhoto.Bytes.Length;existing.RequestHash=preparedPhoto.Hash;existing.Status="uploading";existing.Deleted=false;existing.DeletedAt=null;
                }
                uploads.Add(new PendingUpload(existing,preparedPhoto.Bytes,preparedPhoto.Hash,photoById!=null,expectedGeneration));
            }

            foreach(var photo in set.Where(photo=>!photo.Deleted))photo.Date=body.Date;
            if(receipt==null&&(uploads.Count>0||dateChanged||input.MutationId!=null))
            {
                body.Revision=++user.Revision;user.BodyRevision=user.Revision;body.Updated=DateTime.UtcNow;
                if(input.MutationId is {} id)db.Receipts.Add(new MutationReceipt {Id=id,UserId=uid,Hash=requestHash,Revision=body.Revision});
            }
            await db.SaveChangesAsync(ct);
            await gate.Commit(ct);
        }

        if(uploads.Count==0)return await SetViews(input.Id,ct);
        foreach(var pending in uploads)
        {
            await db.Entry(pending.Photo).ReloadAsync(ct);
            Validation.Require(!pending.Photo.Deleted,"Photo draft expired or was deleted. Create a new draft.",409);
            Validation.Require(pending.Photo.RequestHash==pending.Hash,"This photo was replaced on another device. Review before retrying.",409);
            if(pending.Photo.Status=="complete"&&pending.Photo.RequestHash==pending.Hash)continue;
            // GCS I/O is deliberately outside the account lock. The finalize transaction below
            // only commits the generation pointer and a durable old-generation delete work item.
            var generation=await store.Put(pending.Photo.ObjectPath,pending.Bytes,ct,pending.Replace,pending.ExpectedGeneration);
            Validation.Require(!string.IsNullOrWhiteSpace(generation),"Google Cloud did not return a photo generation. Your local draft is retained; retry when storage is available.",503);
            var uploadedGeneration=generation!;
            await using (var finalize=await MutationLock.Acquire(db,uid,ct))
            {
                await db.Entry(pending.Photo).ReloadAsync(ct);
                if(pending.Photo.Status=="complete")
                {
                    // Another request won the finalize race. The generation returned by this
                    // request is still a real billable object; queue it unless the winner stored
                    // this exact generation so a retry cannot leave an orphan behind.
                    if(!string.Equals(pending.Photo.ObjectGeneration,uploadedGeneration,StringComparison.Ordinal))
                        db.PhotoObjectDeletions.Add(new PhotoObjectDeletion { UserId=uid, ObjectPath=pending.Photo.ObjectPath, ObjectGeneration=uploadedGeneration });
                    await db.SaveChangesAsync(CancellationToken.None);await finalize.Commit(CancellationToken.None);continue;
                }
                if(pending.Photo.Deleted||pending.Photo.RequestHash!=pending.Hash)
                {
                    // The upload completed after a newer edit or delete won. Keep the exact
                    // generation in the durable deletion queue before reporting the conflict.
                    db.PhotoObjectDeletions.Add(new PhotoObjectDeletion { UserId=uid, ObjectPath=pending.Photo.ObjectPath, ObjectGeneration=uploadedGeneration });
                    await db.SaveChangesAsync(CancellationToken.None);await finalize.Commit(CancellationToken.None);
                    throw new DomainException("This photo was replaced on another device. Review before retrying.",409);
                }
                if(pending.ExpectedGeneration is not null && uploadedGeneration!=pending.ExpectedGeneration)
                    db.PhotoObjectDeletions.Add(new PhotoObjectDeletion { UserId=uid, ObjectPath=pending.Photo.ObjectPath, ObjectGeneration=pending.ExpectedGeneration });
                pending.Photo.ObjectGeneration=uploadedGeneration;
                pending.Photo.Status="complete";
                await db.SaveChangesAsync(ct);
                await finalize.Commit(ct);
            }
        }
        await using var uploadGate=await MutationLock.Acquire(db,uid,ct);
        var uploadedBody=await db.BodyRecords.SingleAsync(b=>b.Id==input.Id,ct);
        var completedIds=uploads.Select(p=>p.Photo.Id).ToHashSet();
        uploadedBody.PendingPhotosJson=Json.Write(Json.Read<List<BodyPhotoIntent>>(uploadedBody.PendingPhotosJson).Where(p=>!completedIds.Contains(p.Id)).ToList());
        await db.SaveChangesAsync(ct);
        await uploadGate.Commit(ct);
        return await SetViews(input.Id,ct);
    }

    private async Task<IReadOnlyList<PhotoView>> SetViews(Guid setId,CancellationToken ct)
        =>(await db.Photos.Where(photo=>photo.SetId==setId&&!photo.Deleted&&photo.Status=="complete").OrderBy(photo=>photo.Angle).ToListAsync(ct)).Select(View).ToList();

    public async Task<byte[]> Content(Guid id,CancellationToken ct)
    {
        var content=await ContentWithMetadata(id,ct);
        return content.Bytes;
    }

    public async Task<(byte[] Bytes,string? Generation)> ContentWithMetadata(Guid id,CancellationToken ct)
    {
        var photo=await db.Photos.SingleOrDefaultAsync(p=>p.Id==id&&!p.Deleted&&p.Status=="complete",ct)??throw new DomainException("Photo not found.",404);
        return (await store.Get(photo.ObjectPath,ct),photo.ObjectGeneration);
    }

    public async Task Delete(Guid id,CancellationToken ct)
    {
        await using var gate=await MutationLock.Acquire(db,db.CurrentUser,ct);
        var photo=await db.Photos.SingleOrDefaultAsync(p=>p.Id==id,ct)??throw new DomainException("Photo not found.",404);
        var body=await db.BodyRecords.SingleOrDefaultAsync(b=>b.Id==photo.SetId,ct);
        if(body!=null)
        {
            var user=await db.Users.SingleAsync(u=>u.Id==db.CurrentUser,ct);
            body.Revision=++user.Revision;user.BodyRevision=user.Revision;body.Updated=DateTime.UtcNow;
            body.PendingPhotosJson=Json.Write(Json.Read<List<BodyPhotoIntent>>(body.PendingPhotosJson).Where(p=>p.Id!=id).ToList());
        }
        photo.Deleted=true;photo.Status="deleting";photo.DeletedAt=DateTime.UtcNow;await db.SaveChangesAsync(ct);await gate.Commit(ct);
        // Keep a deletion marker until GCS confirms deletion; scheduled cleanup retries failures.
        await store.Delete(photo.ObjectPath,ct,photo.ObjectGeneration);photo.Status="deleted";await db.SaveChangesAsync(ct);
    }

    public async Task<int> Cleanup(CancellationToken ct)
    {
        db.MaintenanceAccess=true;var now=DateTime.UtcNow;
        var photos=await db.Photos.IgnoreQueryFilters()
            .Where(p=>p.Status=="deleting"||(p.Status=="uploading"&&p.ObjectGeneration==null&&p.Created<now.AddDays(-1)))
            .OrderBy(p=>p.Created).ThenBy(p=>p.Id).Take(100).ToListAsync(ct);
        var count=0;foreach(var photo in photos)
        {
            await using var gate=await MutationLock.Acquire(db,photo.UserId,ct);
            await db.Entry(photo).ReloadAsync(ct);
            if(photo.Status is "complete" or "deleted")continue;
            try{await store.Delete(photo.ObjectPath,ct,photo.ObjectGeneration);photo.Deleted=true;photo.Status="deleted";photo.DeletedAt??=DateTime.UtcNow;await db.SaveChangesAsync(ct);await gate.Commit(ct);count++;}catch(DomainException){/* Retry at next scheduled wake. */}catch(HttpRequestException){/* Retry at next scheduled wake. */}
        }
        var work=await db.PhotoObjectDeletions.IgnoreQueryFilters()
            .Where(item=>item.Status=="pending"&&item.NextAttemptAt<=now)
            .OrderBy(item=>item.NextAttemptAt).ThenBy(item=>item.Id).Take(100).ToListAsync(ct);
        foreach(var item in work)
        {
            try
            {
                await store.Delete(item.ObjectPath,ct,item.ObjectGeneration);
                item.Status="completed";item.CompletedAt=DateTime.UtcNow;item.LastError="";count++;
            }
            catch(DomainException ex)
            {
                item.Attempts++;item.LastError=ex.Message;
                item.NextAttemptAt=DateTime.UtcNow.AddMinutes(Math.Min(60,Math.Pow(2,Math.Min(item.Attempts,6))));
            }
            catch(HttpRequestException ex)
            {
                item.Attempts++;item.LastError=ex.Message;
                item.NextAttemptAt=DateTime.UtcNow.AddMinutes(Math.Min(60,Math.Pow(2,Math.Min(item.Attempts,6))));
            }
        }
        await db.PhotoObjectDeletions.IgnoreQueryFilters().Where(item=>item.Status=="completed"&&item.CompletedAt<DateTime.UtcNow.AddDays(-7)).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct);return count;
    }

    public static PhotoView View(PhysiquePhoto photo)=>new(photo.Id,photo.SetId,photo.Date,photo.Angle,photo.Bytes,photo.Status);

    private sealed record PreparedPhoto(PhotoPart Part,byte[] Bytes,string Hash);
    private sealed record PendingUpload(PhysiquePhoto Photo,byte[] Bytes,string Hash,bool Replace,string? ExpectedGeneration);
    private sealed record CursorValue(DateOnly Date,Guid SetId);
}
