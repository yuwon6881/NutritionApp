using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

/// Reads the encrypted server snapshot without making a provider request or waiting for uploads.
public static class GoogleHealthStepReads
{
    public static async Task<GoogleHealthSyncResult> ReadCachedAsync(
        GoogleHealthService service, AppDb db, IGoogleHealthKms kms, CancellationToken ct, bool includeDays = true)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        ct = deadline.Token;
        var userId = db.CurrentUser!.Value;
        var connection = await db.GoogleHealthConnections.AsNoTracking().SingleOrDefaultAsync(x => x.UserId == userId, ct);
        if (connection is null) return new("disconnected", null, null, "unavailable", []);
        IReadOnlyList<GoogleHealthDay> days = [];
        string? warning = null;
        if (includeDays && connection.Status == "connected" && connection.LastSyncedAt is not null)
        {
            try
            {
                var profile = await db.Users.Where(x => x.Id == userId).Select(x => x.ProfileJson).SingleAsync(ct);
                var today = RetentionService.Today(profile);
                var zone = string.IsNullOrWhiteSpace(profile) ? "Asia/Kuala_Lumpur" : Json.Read<Profile>(profile).TimeZone;
                if (GoogleHealthService.SyncCache.TryGetValue<GoogleHealthService.CachedSync>(userId, out var cached)
                    && cached is not null && cached.ConnectionGeneration == connection.ConnectionGeneration
                    && DateTime.UtcNow - connection.LastSyncedAt.Value < TimeSpan.FromMinutes(2)
                    && cached.LocalDate == today && cached.TimeZone == zone && cached.Result.LastSyncedAt == connection.LastSyncedAt)
                    return await service.AttachSyncStatusesAsync(userId, cached.Result, ct);
                var json = await kms.DecryptAsync(connection.EncryptedStepHistoryJson, ct);
                var stored = JsonSerializer.Deserialize<List<GoogleHealthDay>>(json, Json.Options) ?? [];
                days = stored.Where(day => day.Date >= today.AddDays(-30) && day.Date <= today).ToArray();
                if (DateTime.UtcNow - connection.LastSyncedAt.Value < TimeSpan.FromMinutes(2)
                    && stored.Any(day => day.Date == today))
                {
                    var snapshot = new GoogleHealthSyncResult(connection.Status, connection.ConnectedAt, connection.LastSyncedAt, "fresh", days);
                    GoogleHealthService.SyncCache.Set(userId, new GoogleHealthService.CachedSync(DateTime.UtcNow, snapshot,
                        connection.ConnectionGeneration, today, zone), new MemoryCacheEntryOptions {Size = 1, AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2)});
                    return await service.AttachSyncStatusesAsync(userId, snapshot, ct);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { warning = "Saved steps could not be read. Trying Google Health again."; }
        }
        return await service.AttachSyncStatusesAsync(userId, new(connection.Status, connection.ConnectedAt,
            connection.LastSyncedAt, days.Count > 0 ? "stale" : "unavailable", days,
            warning is null ? null : "cache_unavailable", warning), ct);
    }

    public static async Task<GoogleHealthSyncResult> RefreshAsync(
        GoogleHealthService service, AppDb db, IGoogleHealthKms kms, CancellationToken ct, bool force = true)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(10));
        try { return await service.SyncAsync(db.CurrentUser!.Value, deadline.Token, force); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            db.ChangeTracker.Clear();
            using var fallback = CancellationTokenSource.CreateLinkedTokenSource(ct);
            fallback.CancelAfter(TimeSpan.FromSeconds(3));
            var saved = await ReadCachedAsync(service, db, kms, fallback.Token);
            return saved with { Freshness = saved.Days.Count > 0 ? "stale" : "unavailable",
                WarningCode = "sync_timeout", WarningMessage = "Google Health is taking longer than expected. Try again shortly." };
        }
    }
}
