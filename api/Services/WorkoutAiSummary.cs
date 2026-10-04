using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services;

public sealed record WorkoutPeerResult(string ConnectionState, string Availability, string Freshness,
    DateOnly From, DateOnly To, string TimeZone, DateOnly? CoveredFrom, DateOnly? CoveredTo, DateTime? LastSuccessAt,
    bool CompleteCoverage, string? Warning, IReadOnlyList<TrainingSummaryItem> Items);

public sealed partial class WorkoutSummaryService
{
    public async Task<WorkoutPeerResult> GetForAi(DateOnly from, DateOnly to, string timeZone, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        var connected = await IsConnected(ct);
        var ownerState = connected ? "connected" : "disconnected";
        if (connected && peerTokens != null)
        {
            try { ownerState = await peerTokens.GetConnectionState("workout", timeout.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { ownerState = "temporary_unavailable"; }
            connected = await IsConnected(ct);
        }
        var cache = await db.WorkoutSummaries.AsNoTracking().SingleOrDefaultAsync(ct);
        // Fetch an extra day at each boundary to include sessions finishing after local midnight.
        var fetchFrom = from.AddDays(-1);
        var fetchTo = to.AddDays(1);
        var covered = cache?.SummarySchemaVersion >= 2 && cache.CoverageTimeZone == timeZone
            && cache.CoverageFrom <= fetchFrom && cache.CoverageTo >= fetchTo;
        var fresh = connected && ownerState == "connected" && covered && cache?.LastSuccessAt >= DateTime.UtcNow.AddMinutes(-15);
        logger?.LogInformation("Workout AI summary read: cacheHit={CacheHit}, refreshAttempt={Refresh}, from={From}, to={To}.",
            fresh, !fresh && ownerState == "connected", from, to);
        IReadOnlyList<TrainingSummaryItem> items;
        try { items = await Get(fetchFrom, fetchTo, timeZone, timeout.Token, TimeSpan.FromSeconds(10), cacheOnly: fresh || ownerState != "connected"); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { items = await Get(fetchFrom, fetchTo, timeZone, ct, cacheOnly: true); ownerState = "temporary_unavailable"; }
        var live = LastReadLive;
        var rejected = AccessRejected || ownerState is "reconnect_required" or "upgrade_required";
        cache = await db.WorkoutSummaries.AsNoTracking().SingleOrDefaultAsync(ct);
        covered = cache?.SummarySchemaVersion >= 2 && cache.CoverageTimeZone == timeZone
            && cache.CoverageFrom <= fetchFrom && cache.CoverageTo >= fetchTo;
        if (!live && cache?.CoverageTimeZone != null && cache.CoverageTimeZone != timeZone) items = [];
        if (rejected) items = [];
        var warning = connected ? await GetLastError(ct) : null;
        if (!live && !fresh && connected) warning ??= "Workout could not be refreshed; cached evidence may be stale.";
        if (!covered) warning ??= "Cached coverage or timezone is incomplete; absence is not proof of no training.";
        var selected = items.Where(w => w.Status == Upcoming || w.Status == "in_progress"
            || (w.CompletionDate ?? w.LocalDate) >= from && (w.CompletionDate ?? w.LocalDate) <= to).ToArray();
        return new(rejected ? "reconnect_required" : ownerState,
            live || fresh || selected.Length > 0 ? "available" : "unavailable",
            live ? "live" : fresh ? "fresh_cached" : selected.Length > 0 ? "stale" : "unavailable",
            from, to, timeZone, cache?.CoverageFrom, cache?.CoverageTo, cache?.LastSuccessAt,
            connected && ownerState == "connected" && !rejected && covered, warning, selected);
    }
}

public sealed record TrainingWindow(DateOnly From, DateOnly To, int CompletedSessions, int WorkingSets,
    int? RepWorkingSets, int? TimedWorkingSets, int? DurationSeconds, double? ExternalVolumeKg, double? SystemVolumeKg,
    int ExternalVolumeKnownSessions, int SystemVolumeKnownSessions, double? RecordedSetRpe, int? EffortRecordedSets,
    IReadOnlyList<string> ExerciseMix);
public sealed record TrainingComparison(TrainingWindow Previous, TrainingWindow Current, bool CompleteCoverage,
    bool ExerciseMixChanged, double? WorkingSetChangePercent, double? ExternalVolumeChangePercent, double? SystemVolumeChangePercent,
    string Note);

public static class WorkoutAiComparisons
{
    public static TrainingComparison? Compare(WorkoutPeerResult result, DateOnly today)
    {
        var end = today.AddDays(-1);
        var start = today.AddDays(-14);
        if (result.From > start || result.To < end) return null;
        var previous = Window(result.Items, start, today.AddDays(-8));
        var current = Window(result.Items, today.AddDays(-7), end);
        var mixChanged = !previous.ExerciseMix.SequenceEqual(current.ExerciseMix);
        double? Change(double? before, double? after) => result.CompleteCoverage && before is > 0 && after.HasValue
            ? Math.Round((after.Value - before.Value) / before.Value * 100, 1) : null;
        return new(previous, current, result.CompleteCoverage, mixChanged,
            Change(previous.WorkingSets, current.WorkingSets),
            mixChanged ? null : Change(previous.ExternalVolumeKg, current.ExternalVolumeKg),
            mixChanged ? null : Change(previous.SystemVolumeKg, current.SystemVolumeKg),
            "Completed sessions by local completion date. Volume comparisons require the same exercise/load-model mix and known values. Recorded set RPE is not session RPE. Cached effort is withheld until a live read confirms tracking.");
    }

    public static TrainingWindow Window(IReadOnlyList<TrainingSummaryItem> items, DateOnly from, DateOnly to)
    {
        var rows = items.Where(w => w.Status == "completed" && w.CompletionDate >= from && w.CompletionDate <= to).ToArray();
        static int? Sum(IEnumerable<int?> values) => values.Any(v => !v.HasValue) ? null : values.Sum(v => v ?? 0);
        double? Volume(Func<TrainingSummaryItem, double?> select, Func<TrainingSummaryItem, bool?> complete) => rows.Length == 0 || rows.Any(w => select(w) == null || complete(w) != true)
            ? null : rows.Sum(w => select(w)!.Value);
        var effortCount = Sum(rows.Select(w => w.EffortRecordedSets));
        var effort = rows.Where(w => w.EffortRecordedSets > 0 && w.AverageRpe != null).ToArray();
        return new(from, to, rows.Length, rows.Sum(w => w.WorkingSetCount), Sum(rows.Select(w => w.RepWorkingSets)),
            Sum(rows.Select(w => w.TimedWorkingSets)), Sum(rows.Select(w => w.DurationSeconds)),
            Volume(w => w.ExternalVolumeKg, w => w.ExternalVolumeComplete), Volume(w => w.SystemVolumeKg, w => w.SystemVolumeComplete), rows.Count(w => w.ExternalVolumeKg != null && w.ExternalVolumeComplete == true),
            rows.Count(w => w.SystemVolumeKg != null && w.SystemVolumeComplete == true), effortCount > 0 && effort.Length > 0 && effortCount == effort.Sum(w => w.EffortRecordedSets!.Value)
                ? Math.Round(effort.Sum(w => w.AverageRpe!.Value * w.EffortRecordedSets!.Value) / effortCount.Value, 1) : null,
            effortCount, rows.SelectMany(w => w.ExerciseMix ?? []).Distinct().Order().ToArray());
    }
}
