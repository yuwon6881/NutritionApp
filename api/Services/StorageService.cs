using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

using Microsoft.Extensions.Configuration;

namespace Nutrition.Api.Services;
public record StorageInfo(long DatabaseBytes,long PendingImageBytes,bool Warning,bool OptionalWritesBlocked);
public sealed class StorageService(AppDb db,IMemoryCache cache,TemporaryImageStore images,IConfiguration? config=null)
{
    private const string OverviewCacheKey = "nutrition:storage:overview";

    public async Task<StorageInfo> Overview(CancellationToken ct, bool bypassCache = false)
    {
        if (!bypassCache && cache.TryGetValue<StorageInfo>(OverviewCacheKey, out var cached) && cached is not null)
            return cached;
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
        var warningBytes=config?.GetValue("Storage:DatabaseWarningBytes",350_000_000L)??350_000_000L;
        var blockBytes=config?.GetValue("Storage:DatabaseBlockBytes",400_000_000L)??400_000_000L;
        var result=new StorageInfo(size,imageBytes,size>=warningBytes,size>=blockBytes);
        cache.Set(OverviewCacheKey,result,new MemoryCacheEntryOptions { Size=1,AbsoluteExpirationRelativeToNow=TimeSpan.FromSeconds(30) });
        return result;
    }
    public async Task AllowOptional(CancellationToken ct)
    {
        // Quota enforcement always reads current counters. The short-lived cache is for the
        // operational telemetry endpoint only; concurrent writes must not rely on a stale total.
        var info=await Overview(ct,bypassCache:true);
        if(info.OptionalWritesBlocked) { if(cache is MemoryCache memory) memory.Compact(1); throw new DomainException("Storage is near its limit. Export your history; optional food/AI storage is paused.",507); }
        var imageLimit=config?.GetValue("Storage:TemporaryImageBytes",100_000_000L)??100_000_000L;
        Validation.Require(info.PendingImageBytes<imageLimit,"Temporary scan storage is full. Cleanup must finish before another scan.",507);
    }
    // Only the authenticated scheduler endpoint calls this global maintenance path.
    public async Task<int> Cleanup(CancellationToken ct)
    {
        db.MaintenanceAccess=true;
        var now=DateTime.UtcNow;
        var candidates=await db.Scans.IgnoreQueryFilters()
            .Where(s=>s.ObjectPath!=null&&(s.Created<now.AddHours(-24)||s.Status=="complete"||s.Status=="failed"))
            .OrderBy(s=>s.Created).ThenBy(s=>s.Id).Take(200).ToListAsync(ct);
        var count=0;
        foreach(var scan in candidates)
        {
            if(scan.LeaseUntil>now) continue;
            try { await images.Delete(scan.ObjectPath!,ct); scan.ObjectPath=null; if(scan.Status is "queued" or "uploading" or "processing") { scan.Status="failed";scan.Error="Scan expired. Try again."; } count++; }
            catch(DomainException) { /* Keep the durable path so the next scheduler call retries. */ }
        }
        await db.SaveChangesAsync(ct);
        var aiUsageMonths = Math.Max(1, config?.GetValue("Retention:AiUsageMonths", 2) ?? 2);
        await db.Scans.IgnoreQueryFilters().Where(s=>s.Created<now.AddDays(-7)&&s.ObjectPath==null).ExecuteDeleteAsync(ct);
        await db.Sessions.Where(s=>s.Expires<now).ExecuteDeleteAsync(ct);
        await db.Usage.IgnoreQueryFilters().Where(u=>u.Date<DateOnly.FromDateTime(now.AddMonths(-aiUsageMonths))).ExecuteDeleteAsync(ct);
        await db.GoogleHealthOAuthStates.IgnoreQueryFilters().Where(s=>s.ExpiresAt<now).ExecuteDeleteAsync(ct);
        // Trajectory rows are a rebuildable 90-day read cache. Keep a small
        // repair margin, but prune them from the scheduled maintenance path
        // instead of making every bootstrap request issue a delete.
        var trajectoryDays = Math.Max(90, config?.GetValue("Retention:TrajectoryDays", 120) ?? 120);
        await db.ExpenditureEstimates.IgnoreQueryFilters()
            .Where(item => item.Date < DateOnly.FromDateTime(now.AddDays(-trajectoryDays)))
            .ExecuteDeleteAsync(ct);
        // Public product rows contain no account data and are rebuildable. Keep the durable cache
        // bounded across restarts while retaining the active freshness window.
        await db.PublicFoodProducts
            .Where(product => product.ExpiresAt < now.AddDays(-7))
            .OrderBy(product => product.ExpiresAt).ThenBy(product => product.Code)
            .Take(500).ExecuteDeleteAsync(ct);
        // Photos and BodyRecords: purge tombstones older than the retention window so that
        // clients offline longer than this period do a full re-pull on reconnect.
        var tombstoneDays = Math.Max(1, config?.GetValue("Retention:TombstoneDays", 90) ?? 90);
        var tombstoneCutoff = now.AddDays(-tombstoneDays);
        // Foods are returned as a full active set, but a tombstone still needs to survive long
        // enough for an offline client to reject an expired replay. Legacy rows with no timestamp
        // are removed during maintenance; newly written deletions always carry DeletedAt.
        await db.Foods.IgnoreQueryFilters().Where(f=>f.Deleted &&
            (f.DeletedAt==null || f.DeletedAt<tombstoneCutoff)).ExecuteDeleteAsync(ct);
        // A deletion marker is the durable queue for external object removal. Purge only after
        // GCS has confirmed the exact generation and the configured tombstone window has elapsed.
        await db.Photos.IgnoreQueryFilters().Where(p=>p.Deleted&&p.Status=="deleted"&&
            ((p.DeletedAt!=null&&p.DeletedAt<tombstoneCutoff)||(p.DeletedAt==null&&p.Created<tombstoneCutoff)))
            .ExecuteDeleteAsync(ct);
        await db.BodyRecords.IgnoreQueryFilters().Where(b=>b.Deleted&&
            ((b.DeletedAt!=null&&b.DeletedAt<tombstoneCutoff)||(b.DeletedAt==null&&b.Created<tombstoneCutoff)))
            .ExecuteDeleteAsync(ct);
        cache.Remove(OverviewCacheKey);
        return count;
    }
}
