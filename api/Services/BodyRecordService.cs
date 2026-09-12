using System.Globalization;
using System.Reflection;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record BodyPhotoIntent(Guid Id, string Angle);
// A missing measurement key retains its value; an explicit null clears it.
public sealed record BodyPatch(DateOnly? Date = null, Dictionary<string,double?>? Measurements = null,
    IReadOnlyList<BodyPhotoIntent>? Photos = null, BodyWeightContext? WeightContext = null,
    bool OmitScale = false, bool OmitTrend = false);
public sealed record BodyMutation(Guid Id, long ExpectedRevision, BodyPatch? Data = null, string Action = "save", Guid? PhotoId = null);
public sealed record BodyRecordView(Guid Id, DateOnly Date, long CreationOrder, long Revision, bool Deleted,
    DateTime Created, DateTime Updated, BodyMeasurements Measurements, BodyWeightContext WeightContext,
    IReadOnlyList<PhotoView> Photos);
public sealed record BodyPage(Guid AccountId, long Revision, bool Configured, long UsedBytes, long MaxBytes,
    IReadOnlyList<BodyRecordView> Records, string? NextCursor, bool HasMore);

public sealed class BodyRecordService(AppDb db, GcsPhotoStore store, IConfiguration config)
{
    public const string TrendVersion = "coach-trend-half-life-7d-v1";
    public static readonly IReadOnlyDictionary<string,PropertyInfo> MeasurementFields = typeof(BodyMeasurements)
        .GetProperties().ToDictionary(p=>char.ToLowerInvariant(p.Name[0])+p.Name[1..],StringComparer.Ordinal);

    public async Task<BodyPage> Page(string? cursor, bool photosOnly, CancellationToken ct)
    {
        var uid=db.CurrentUser??throw new DomainException("Sign in again.",401);
        await MigrateLegacyPhotoSets(ct);
        var query=db.BodyRecords.AsNoTracking().Where(b=>!b.Deleted);
        if(photosOnly)query=query.Where(b=>db.Photos.Any(p=>p.SetId==b.Id&&!p.Deleted&&p.Status=="complete"));
        if(!string.IsNullOrEmpty(cursor))
        {
            var after=DecodeCursor(cursor);
            query=query.Where(b=>b.Date<after.Date||(b.Date==after.Date&&b.CreationOrder<after.Order));
        }
        var records=await query.OrderByDescending(b=>b.Date).ThenByDescending(b=>b.CreationOrder).Take(21).ToListAsync(ct);
        var hasMore=records.Count>20;
        var page=records.Take(20).ToList();
        var ids=page.Select(b=>b.Id).ToArray();
        var photos=await db.Photos.AsNoTracking().Where(p=>ids.Contains(p.SetId)&&!p.Deleted).ToListAsync(ct);
        return new(uid,await db.Users.Where(u=>u.Id==uid).Select(u=>u.Revision).SingleAsync(ct),store.Configured,
            await db.Photos.Where(p=>!p.Deleted).SumAsync(p=>(long)p.Bytes,ct),config.GetValue("Physique:MaxBytesPerUser",268435456L),
            page.Select(b=>View(b,photos.Where(p=>p.SetId==b.Id))).ToList(),hasMore?EncodeCursor(page[^1]):null,hasMore);
    }

    public async Task<BodyRecordView> Detail(Guid id,CancellationToken ct)
    {
        var record=await db.BodyRecords.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(b=>b.Id==id&&b.UserId==db.CurrentUser,ct)
            ??throw new DomainException("Body record not found.",404);
        return View(record,await db.Photos.AsNoTracking().Where(p=>p.SetId==id&&!p.Deleted).ToListAsync(ct));
    }

    public async Task<BodyWeightContext> Capture(DateOnly date,CancellationToken ct)
    {
        var user=await db.Users.AsNoTracking().SingleAsync(u=>u.Id==db.CurrentUser,ct);
        ValidateDate(date,user.ProfileJson);
        var history=await db.Weights.AsNoTracking().Where(w=>!w.Deleted&&w.Date<=date).OrderBy(w=>w.Date)
            .Select(w=>new WeightPoint(w.Date,w.Kg)).ToListAsync(ct);
        var scale=history.LastOrDefault();
        var trend=Coach.Trend(history).LastOrDefault();
        return new(scale?.Kg,scale?.Date,trend?.Kg,trend?.Date,DateTime.UtcNow,TrendVersion,"server");
    }

    public async Task<BodyRecordView> Apply(Guid recordId,BodyMutation op,CancellationToken ct)
    {
        var uid=db.CurrentUser??throw new DomainException("Sign in again.",401);
        Validation.Require(recordId!=Guid.Empty&&op.Id!=Guid.Empty,"Body record and mutation identities are required.");
        Validation.Require(op.Action is "save" or "delete" or "photo-delete","Unknown Body record action.");
        var hash=AuthService.Hash(Json.Write(new {recordId,op}));
        await using(var gate=await MutationLock.Acquire(db,uid,ct))
        {
            var receipt=await db.Receipts.SingleOrDefaultAsync(r=>r.Id==op.Id,ct);
            if(receipt!=null)
            {
                Validation.Require(receipt.Hash==hash,"Idempotency key reused for different data.",409);
                return await Detail(recordId,ct);
            }
            var user=await db.Users.SingleAsync(u=>u.Id==uid,ct);
            var record=await db.BodyRecords.IgnoreQueryFilters().SingleOrDefaultAsync(b=>b.Id==recordId&&b.UserId==uid,ct);
            Validation.Require((record?.Revision??0)==op.ExpectedRevision,"This Body record changed on another device. Review the conflict.",409);
            Validation.Require(record is not {Deleted:true},"This Body record was deleted. Keep your draft or create a new record.",409);
            var isNew=record==null;
            if(isNew)
            {
                Validation.Require(op.Action=="save"&&op.Data?.Date!=null,"Choose a Body record date.");
                record=new BodyRecord {Id=recordId,UserId=uid,Date=op.Data!.Date!.Value,Created=DateTime.UtcNow,
                    CreationOrder=await NextOrder(db,ct)};
            }
            var body=record!;
            if(op.Action=="delete")
            {
                body.Deleted=true;body.PendingPhotosJson="[]";
                foreach(var photo in await db.Photos.Where(p=>p.SetId==recordId&&!p.Deleted).ToListAsync(ct))
                {photo.Deleted=true;photo.Status="deleting";}
            }
            else if(op.Action=="photo-delete")
            {
                Validation.Require(op.PhotoId!=null,"Choose a photo to delete.");
                var photo=await db.Photos.SingleOrDefaultAsync(p=>p.SetId==recordId&&p.Id==op.PhotoId,ct);
                var pending=Json.Read<List<BodyPhotoIntent>>(body.PendingPhotosJson);
                Validation.Require(photo!=null||pending.Any(p=>p.Id==op.PhotoId),"Photo not found.",404);
                if(photo!=null){photo.Deleted=true;photo.Status="deleting";}
                body.PendingPhotosJson=Json.Write(pending.Where(p=>p.Id!=op.PhotoId).ToList());
            }
            else
            {
                var patch=op.Data??throw new DomainException("Body record data is required.");
                if(patch.Date is {} date)body.Date=date;
                ValidateDate(body.Date,user.ProfileJson);
                ApplyMeasurements(body.Measurements,patch.Measurements);
                if(patch.Photos!=null)
                {
                    ValidateIntents(patch.Photos);
                    var pending=Json.Read<List<BodyPhotoIntent>>(body.PendingPhotosJson);
                    var existing=await db.Photos.Where(p=>p.SetId==recordId&&!p.Deleted).ToListAsync(ct);
                    foreach(var intent in patch.Photos)
                    {
                        var previous=existing.FirstOrDefault(p=>p.Angle==intent.Angle);
                        Validation.Require(previous==null||previous.Id==intent.Id,"Keep the existing photo identity when replacing a view.",409);
                        Validation.Require(!existing.Any(p=>p.Id==intent.Id&&p.Angle!=intent.Angle),"Photo identity belongs to another angle.",409);
                        pending.RemoveAll(p=>p.Angle==intent.Angle);pending.Add(intent);
                    }
                    body.PendingPhotosJson=Json.Write(pending);
                }
                if(isNew)
                {
                    Validation.Require(MeasurementFields.Values.Any(p=>p.GetValue(body.Measurements)!=null)||patch.Photos is {Count:>0},
                        "Add at least one measurement or photo. Weight attachments alone cannot create a record.");
                    var context=patch.WeightContext??await Capture(body.Date,ct);
                    ValidateContext(context,body.Date);
                    body.WeightContextJson=Json.Write(Omit(context,patch));
                    db.BodyRecords.Add(body);
                }
                else
                {
                    // A date correction, measurement edit or photo replacement never captures again.
                    Validation.Require(patch.WeightContext==null,"Saved weight attachments are frozen; they can only be omitted.");
                    body.WeightContextJson=Json.Write(Omit(Json.Read<BodyWeightContext>(body.WeightContextJson),patch));
                }
                foreach(var photo in await db.Photos.Where(p=>p.SetId==recordId&&!p.Deleted).ToListAsync(ct))photo.Date=body.Date;
            }
            body.Revision=++user.Revision;body.Updated=DateTime.UtcNow;
            db.Receipts.Add(new MutationReceipt {Id=op.Id,UserId=uid,Hash=hash,Revision=body.Revision});
            await db.SaveChangesAsync(ct);await gate.Commit(ct);
        }
        // Deletion markers survive unavailable object storage. Scheduled cleanup retries them.
        if(op.Action is "delete" or "photo-delete")await CleanupRecordPhotos(recordId,ct);
        return await Detail(recordId,ct);
    }

    public async Task CleanupRecordPhotos(Guid recordId,CancellationToken ct)
    {
        foreach(var photo in await db.Photos.Where(p=>p.SetId==recordId&&p.Status=="deleting").ToListAsync(ct))
        {
            try{await store.Delete(photo.ObjectPath,ct);photo.Status="deleted";await db.SaveChangesAsync(ct);}
            catch(DomainException){/* The retained deletion marker is the retry queue. */}
            catch(HttpRequestException){/* Retry on scheduled cleanup. */}
        }
    }

    public static async Task<BodyRecord> EnsureLegacyUnderLock(AppDb db,Guid setId,DateOnly date,CancellationToken ct)
    {
        var existing=await db.BodyRecords.IgnoreQueryFilters().SingleOrDefaultAsync(b=>b.Id==setId&&b.UserId==db.CurrentUser,ct);
        if(existing!=null){Validation.Require(!existing.Deleted,"Body record was deleted.",409);return existing;}
        var user=await db.Users.SingleAsync(u=>u.Id==db.CurrentUser,ct);
        var body=new BodyRecord {Id=setId,UserId=user.Id,Date=date,CreationOrder=await NextOrder(db,ct),
            Created=DateTime.UtcNow,Updated=DateTime.UtcNow,Revision=++user.Revision,
            WeightContextJson=Json.Write(new BodyWeightContext())};
        db.BodyRecords.Add(body);return body;
    }

    public static Task<long> NextOrder(AppDb db,CancellationToken ct)=>NextOrderCore(db,ct);
    // Keep the sequence scoped to the owning account, including tombstones.
    private static async Task<long> NextOrderCore(AppDb db,CancellationToken ct)
        =>(await db.BodyRecords.MaxAsync(b=>(long?)b.CreationOrder,ct)??0)+1;

    private async Task MigrateLegacyPhotoSets(CancellationToken ct)
    {
        // Photo sets were introduced before Body records. Create a lightweight
        // record for each existing set so history and exports have one owner;
        // the empty snapshot stays explicitly unavailable until a new record is
        // captured by the server.
        var uid=db.CurrentUser??throw new DomainException("Sign in again.",401);
        var candidates=await db.Photos.AsNoTracking()
            .Where(p=>p.UserId==uid&&!p.Deleted&&p.SetId!=Guid.Empty)
            .GroupBy(p=>p.SetId)
            .Select(g=>new {SetId=g.Key,Date=g.Max(p=>p.Date)})
            .Where(x=>!db.BodyRecords.IgnoreQueryFilters().Any(b=>b.UserId==uid&&b.Id==x.SetId))
            .ToListAsync(ct);
        if(candidates.Count==0)return;
        await using var gate=await MutationLock.Acquire(db,uid,ct);
        var user=await db.Users.SingleAsync(u=>u.Id==uid,ct);
        var nextOrder=await NextOrder(db,ct);
        foreach(var candidate in candidates)
        {
            if(await db.BodyRecords.IgnoreQueryFilters().AnyAsync(b=>b.UserId==uid&&b.Id==candidate.SetId,ct))continue;
            db.BodyRecords.Add(new BodyRecord {Id=candidate.SetId,UserId=uid,Date=candidate.Date,
                CreationOrder=nextOrder++,Created=DateTime.UtcNow,Updated=DateTime.UtcNow,
                Revision=++user.Revision,WeightContextJson=Json.Write(new BodyWeightContext())});
        }
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    public static void ApplyMeasurements(BodyMeasurements target,Dictionary<string,double?>? patch)
    {
        if(patch==null)return;
        foreach(var (name,value) in patch)
        {
            Validation.Require(MeasurementFields.TryGetValue(name,out var field),"Unknown Body measurement.");
            if(value is {} number)Validation.Require(double.IsFinite(number)&&number>0&&(name!="bodyFatPercent"||number<100),
                name=="bodyFatPercent"?"Estimated body fat must be strictly between 0 and 100%.":"Circumference must be a finite positive number.");
            field!.SetValue(target,value is null?null:(double?)value);
        }
    }

    private static void ValidateIntents(IReadOnlyList<BodyPhotoIntent> photos)
    {
        Validation.Require(photos.Count<=3&&photos.All(p=>p.Id!=Guid.Empty&&p.Angle is "front" or "side" or "back")
            &&photos.Select(p=>p.Angle).Distinct().Count()==photos.Count&&photos.Select(p=>p.Id).Distinct().Count()==photos.Count,
            "Choose at most one Front, Side and Back photo, with independent identities.");
    }
    public static void ValidateDate(DateOnly date,string profileJson)=>Validation.Require(date>=new DateOnly(2000,1,1)&&date<=RetentionService.Today(profileJson),"Choose a valid Body record date.");
    public static void ValidateContext(BodyWeightContext context,DateOnly date)
    {
        Validation.Require(context.Provenance is "server" or "cached","Identify the weight snapshot source.");
        Validation.Require(context.CapturedAt is {} captured&&captured.Kind==DateTimeKind.Utc&&captured<=DateTime.UtcNow.AddMinutes(5),"Choose a valid snapshot capture timestamp.");
        Validation.Require(context.CalculationVersion==TrendVersion,"Unsupported weight trend version.");
        foreach(var (kg,source) in new[]{(context.ScaleKg,context.ScaleDate),(context.TrendKg,context.TrendDate)})
        {
            Validation.Require((kg==null)==(source==null),"Snapshot values and source dates must be supplied together.");
            if(kg is {} value)Validation.Require(double.IsFinite(value)&&value>=20&&value<=400&&source<=date&&source>=new DateOnly(2000,1,1),"Weight snapshot is outside its source date or range.");
        }
    }
    private static BodyWeightContext Omit(BodyWeightContext context,BodyPatch patch)=>context with
    {ScaleKg=patch.OmitScale?null:context.ScaleKg,ScaleDate=patch.OmitScale?null:context.ScaleDate,
     TrendKg=patch.OmitTrend?null:context.TrendKg,TrendDate=patch.OmitTrend?null:context.TrendDate};

    public static BodyRecordView View(BodyRecord body,IEnumerable<PhysiquePhoto> photos)
    {
        var views=photos.Where(p=>!p.Deleted).Select(PhotoService.View).ToList();
        foreach(var intent in Json.Read<List<BodyPhotoIntent>>(body.PendingPhotosJson))
        {
            var index=views.FindIndex(p=>p.Angle==intent.Angle);
            if(index<0)views.Add(new(intent.Id,body.Id,body.Date,intent.Angle,0,"pending"));
            // Existing bytes remain visible while a replacement is retained separately.
        }
        return new(body.Id,body.Date,body.CreationOrder,body.Revision,body.Deleted,body.Created,body.Updated,
            body.Measurements,Json.Read<BodyWeightContext>(body.WeightContextJson),views.OrderBy(p=>p.Angle).ToList());
    }
    public static string EncodeCursor(BodyRecord record)=>Convert.ToBase64String(Encoding.UTF8.GetBytes($"{record.Date:yyyy-MM-dd}|{record.CreationOrder}"));
    public static (DateOnly Date,long Order) DecodeCursor(string value)
    {
        try
        {
            Validation.Require(value.Length<=120,"Body history cursor is invalid.");
            var parts=Encoding.UTF8.GetString(Convert.FromBase64String(value)).Split('|');
            return (DateOnly.ParseExact(parts[0],"yyyy-MM-dd",CultureInfo.InvariantCulture),long.Parse(parts[1],CultureInfo.InvariantCulture));
        }
        catch {throw new DomainException("Body history cursor is invalid.");}
    }
}
