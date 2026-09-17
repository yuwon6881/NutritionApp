using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

using Microsoft.Extensions.Configuration;

namespace Nutrition.Api.Services;
public record StorageInfo(long DatabaseBytes,long PendingImageBytes,bool Warning,bool OptionalWritesBlocked);
public sealed class StorageService(AppDb db,IMemoryCache cache,TemporaryImageStore images,IConfiguration? config=null)
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
        var aiUsageMonths = Math.Max(1, config?.GetValue("Retention:AiUsageMonths", 2) ?? 2);
        await db.Scans.IgnoreQueryFilters().Where(s=>s.Created<now.AddDays(-7)&&s.ObjectPath==null).ExecuteDeleteAsync(ct);
        await db.Sessions.Where(s=>s.Expires<now).ExecuteDeleteAsync(ct);
        await db.Usage.IgnoreQueryFilters().Where(u=>u.Date<DateOnly.FromDateTime(now.AddMonths(-aiUsageMonths))).ExecuteDeleteAsync(ct);
        await db.GoogleHealthOAuthStates.IgnoreQueryFilters().Where(s=>s.ExpiresAt<now).ExecuteDeleteAsync(ct);
        // Tombstone purge: hard-delete soft-deleted records that no client can need.
        // Foods: the sync protocol always returns the full active set (!Deleted), so tombstones
        // serve no diff purpose and are safe to remove unconditionally.
        await db.Foods.IgnoreQueryFilters().Where(f=>f.Deleted).ExecuteDeleteAsync(ct);
        // Photos and BodyRecords: purge tombstones older than the retention window so that
        // clients offline longer than this period do a full re-pull on reconnect.
        var tombstoneDays = Math.Max(1, config?.GetValue("Retention:TombstoneDays", 90) ?? 90);
        var tombstoneCutoff = now.AddDays(-tombstoneDays);
        await db.Photos.IgnoreQueryFilters().Where(p=>p.Deleted&&p.Created<tombstoneCutoff).ExecuteDeleteAsync(ct);
        await db.BodyRecords.IgnoreQueryFilters().Where(b=>b.Deleted&&b.Created<tombstoneCutoff).ExecuteDeleteAsync(ct);
        return count;
    }
}
