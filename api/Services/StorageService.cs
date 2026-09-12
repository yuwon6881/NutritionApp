using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;
public record StorageInfo(long DatabaseBytes,long PendingImageBytes,bool Warning,bool OptionalWritesBlocked);
public sealed class StorageService(AppDb db,IMemoryCache cache,TemporaryImageStore images)
{
    public async Task<StorageInfo> Overview(CancellationToken ct)
    {
        var connection=db.Database.GetDbConnection(); var wasClosed=connection.State!=System.Data.ConnectionState.Open;
        if(wasClosed) await connection.OpenAsync(ct);
        long size;
        try
        {
            await using var command=connection.CreateCommand();
            if(db.Database.IsSqlite()) command.CommandText="SELECT (SELECT page_count FROM pragma_page_count()) * (SELECT page_size FROM pragma_page_size())";
            else command.CommandText="SELECT pg_database_size(current_database())";
            if(db.Database.CurrentTransaction is {} tx) command.Transaction=Microsoft.EntityFrameworkCore.Storage.DbContextTransactionExtensions.GetDbTransaction(tx);
            size=Convert.ToInt64(await command.ExecuteScalarAsync(ct));
        }
        finally { if(wasClosed) await connection.CloseAsync(); }
        // Aggregate capacity is operational metadata, never another user's food or image paths.
        var imageBytes=await db.Scans.IgnoreQueryFilters().Where(s=>s.ObjectPath!=null).SumAsync(s=>(long)s.ImageBytes,ct);
        return new(size,imageBytes,size>=350_000_000,size>=400_000_000);
    }
    public async Task AllowOptional(CancellationToken ct)
    {
        var info=await Overview(ct);
        if(info.OptionalWritesBlocked) { if(cache is MemoryCache memory) memory.Compact(1); throw new DomainException("Storage is near its limit. Export your history; optional food/AI storage is paused.",507); }
        Validation.Require(info.PendingImageBytes<100_000_000,"Temporary scan storage is full. Cleanup must finish before another scan.",507);
    }
    // Only the authenticated scheduler endpoint calls this global maintenance path.
    public async Task<int> Cleanup(CancellationToken ct)
    {
        db.MaintenanceAccess=true;
        var now=DateTime.UtcNow;
        var candidates=await db.Scans.IgnoreQueryFilters().Where(s=>s.ObjectPath!=null&&(s.Created<now.AddHours(-24)||s.Status=="complete"||s.Status=="failed")).Take(200).ToListAsync(ct);
        var count=0;
        foreach(var scan in candidates)
        {
            if(scan.LeaseUntil>now) continue;
            try { await images.Delete(scan.ObjectPath!,ct); scan.ObjectPath=null; if(scan.Status is "queued" or "uploading" or "processing") { scan.Status="failed";scan.Error="Scan expired. Try again."; } count++; }
            catch(DomainException) { /* Keep the durable path so the next scheduler call retries. */ }
        }
        await db.SaveChangesAsync(ct);
        await db.Scans.IgnoreQueryFilters().Where(s=>s.Created<now.AddDays(-7)&&s.ObjectPath==null).ExecuteDeleteAsync(ct);
        await db.Sessions.Where(s=>s.Expires<now).ExecuteDeleteAsync(ct);
        await db.Usage.IgnoreQueryFilters().Where(u=>u.Date<DateOnly.FromDateTime(now.AddMonths(-2))).ExecuteDeleteAsync(ct);
        return count;
    }
}
