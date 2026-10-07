using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record TrainingSummaryItem(
    string Id,
    string Status,
    DateOnly LocalDate,
    DateTime? StartedAt,
    DateTime? FinishedAt,
    string WorkoutName,
    IReadOnlyList<string> MuscleGroups,
    int WorkingSetCount,
    double? ExternalVolumeKg,
    double? SystemVolumeKg,
    double? AverageRpe,
    DateOnly? CompletionDate = null,
    int? RepWorkingSets = null,
    int? TimedWorkingSets = null,
    int? DurationSeconds = null,
    int? EffortRecordedSets = null,
    bool? EffortTracked = null,
    IReadOnlyList<string>? ExerciseMix = null,
    bool? ExternalVolumeComplete = null,
    bool? SystemVolumeComplete = null,
    int? ProgramWeek = null,
    int? ProgramPosition = null);

public sealed class WorkoutCircuitBreaker
{
    private readonly object _gate = new();
    private int _consecutiveFailures;
    private DateTimeOffset _openedAt;
    private bool _halfOpenProbeInFlight;

    public TimeSpan OpenDuration { get; init; } = TimeSpan.FromSeconds(30);
    public int FailureThreshold { get; init; } = 3;

    public bool TryExecute(DateTimeOffset now, out bool isProbe)
    {
        lock (_gate)
        {
            if (_consecutiveFailures < FailureThreshold)
            {
                isProbe = false;
                return true;
            }
            if (now - _openedAt >= OpenDuration)
            {
                if (!_halfOpenProbeInFlight)
                {
                    _halfOpenProbeInFlight = true;
                    isProbe = true;
                    return true;
                }
            }
            isProbe = false;
            return false;
        }
    }

    public void RecordSuccess()
    {
        lock (_gate)
        {
            _consecutiveFailures = 0;
            _halfOpenProbeInFlight = false;
        }
    }

    public void RecordFailure(DateTimeOffset now)
    {
        lock (_gate)
        {
            _consecutiveFailures++;
            _halfOpenProbeInFlight = false;
            if (_consecutiveFailures >= FailureThreshold)
            {
                _openedAt = now;
            }
        }
    }

    public void ReleaseProbe()
    {
        lock (_gate)
        {
            _halfOpenProbeInFlight = false;
        }
    }

    public bool IsOpen(DateTimeOffset now)
    {
        lock (_gate)
        {
            return _consecutiveFailures >= FailureThreshold && (now - _openedAt < OpenDuration);
        }
    }

    public void Reset()
    {
        lock (_gate)
        {
            _consecutiveFailures = 0;
            _halfOpenProbeInFlight = false;
        }
    }
}

public sealed partial class WorkoutSummaryService(AppDb db, IHttpClientFactory clients, IConfiguration config, IntegrationTokenService? peerTokens = null,
    ILogger<WorkoutSummaryService>? logger = null)
{
    public bool LastReadLive { get; private set; }
    public bool AccessRejected { get; private set; }
    private static readonly ConcurrentDictionary<string, WorkoutCircuitBreaker> Breakers = new(StringComparer.OrdinalIgnoreCase);

    public static WorkoutCircuitBreaker GetBreaker(string endpoint) => Breakers.GetOrAdd(endpoint, _ => new WorkoutCircuitBreaker());
    public static void ResetBreakers() => Breakers.Clear();

    /// Reads that block the main Nutrition state stay short so Workout never delays the diary.
    public static readonly TimeSpan InlineDeadline = TimeSpan.FromSeconds(2);
    /// Dedicated summary refreshes may wait out a scale-to-zero cold start of Workout, whose
    /// handler also validates the connection with Fitness Account before answering.
    public static readonly TimeSpan RefreshDeadline = TimeSpan.FromSeconds(15);

    public async Task<bool> IsConnected(CancellationToken ct)
        => await db.IntegrationGrants.AsNoTracking().AnyAsync(x => x.Peer == "workout" && x.Status == "active"
            && x.CentralConnectionId != null && x.CentralGeneration != null, ct);

    public async Task<string?> GetLastError(CancellationToken ct)
    {
        var error = await db.WorkoutSummaries.AsNoTracking()
            .Where(x => x.LastErrorAt != null && x.LastError != "")
            .Select(x => x.LastError)
            .SingleOrDefaultAsync(ct);
        return string.IsNullOrWhiteSpace(error)
            ? null
            : "Workout training summaries are temporarily unavailable. Try again later.";
    }

    public async Task<IReadOnlyList<TrainingSummaryItem>> Get(DateOnly from, DateOnly to, string? timeZone, CancellationToken ct,
        TimeSpan? deadline = null, TimeProvider? timeProvider = null, bool cacheOnly = false)
    {
        LastReadLive = false;
        AccessRejected = false;
        var cache = await db.WorkoutSummaries.AsNoTracking().SingleOrDefaultAsync(ct);
        var url = config["Integrations:WorkoutTrainingSummaryUrl"];
        var connected = await IsConnected(ct);
        var clock = timeProvider ?? TimeProvider.System;
        var now = clock.GetUtcNow();

        if (connected && !cacheOnly)
        {
            if (string.IsNullOrWhiteSpace(url))
            {
                await Save(null, from, to, now.UtcDateTime, "Workout summary endpoint is not configured.", ct);
            }
            else
            {
                var breaker = GetBreaker(url);
                if (!breaker.TryExecute(now, out var isProbe))
                {
                    await Save(null, from, to, now.UtcDateTime, "Workout summaries are temporarily unavailable.", ct);
                }
                else
                {
                    var effectiveDeadline = deadline ?? InlineDeadline;
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    timeout.CancelAfter(effectiveDeadline);

                    try
                    {
                        string? token;
                        if (peerTokens is null)
                        {
                            token = config["Integrations:WorkoutAccessToken"];
                        }
                        else
                        {
                            token = await peerTokens.AccessToken("workout", "workout.training_summary.read", timeout.Token);
                        }

                        if (peerTokens is not null && string.IsNullOrWhiteSpace(token))
                            throw new DomainException("Workout access is temporarily unavailable.", 401);

                        var separator = url.Contains('?') ? '&' : '?';
                        var tz = string.IsNullOrWhiteSpace(timeZone) ? "" : $"&timeZone={Uri.EscapeDataString(timeZone)}";
                        using var request = new HttpRequestMessage(HttpMethod.Get, $"{url}{separator}from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}{tz}");
                        if (!string.IsNullOrWhiteSpace(token)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                        using var response = await clients.CreateClient("workout").SendAsync(request, timeout.Token);

                        if (response.StatusCode is System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden)
                        {
                            AccessRejected = true;
                            await Save(null, from, to, now.UtcDateTime, "Workout access is unauthorized.", ct);
                        }
                        else
                        {
                            response.EnsureSuccessStatusCode();
                            var items = (await response.Content.ReadFromJsonAsync<List<TrainingSummaryItem>>(cancellationToken: timeout.Token) ?? [])
                                .Select(Canonical).ToList();
                            breaker.RecordSuccess();
                            var version = response.Headers.TryGetValues("X-Workout-Summary-Version", out var versions) && versions.Contains("2") ? 2 : 1;
                            await Save(items, from, to, now.UtcDateTime, null, ct, timeZone, version);
                            LastReadLive = true;
                            return items;
                        }
                    }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                    {
                        var failureTime = clock.GetUtcNow();
                        breaker.RecordFailure(failureTime);
                        var shouldRecord = cache is null || string.IsNullOrWhiteSpace(cache.SummaryJson) || breaker.IsOpen(failureTime);
                        await Save(null, from, to, now.UtcDateTime, shouldRecord ? "Workout summaries are temporarily unavailable." : null, ct);
                    }
                    catch (HttpRequestException ex) when (ex.StatusCode is null || (int)ex.StatusCode >= 500)
                    {
                        var failureTime = clock.GetUtcNow();
                        breaker.RecordFailure(failureTime);
                        var shouldRecord = cache is null || string.IsNullOrWhiteSpace(cache.SummaryJson) || breaker.IsOpen(failureTime);
                        await Save(null, from, to, now.UtcDateTime, shouldRecord ? ex.Message : null, ct);
                    }
                    catch (HttpRequestException ex)
                    {
                        await Save(null, from, to, now.UtcDateTime, ex.Message, ct);
                    }
                    catch (DomainException ex) when (ex.Status is 401 or 403)
                    {
                        await Save(null, from, to, now.UtcDateTime, "Workout access is temporarily unavailable.", ct);
                    }
                    catch (Exception ex) when (ex is JsonException or InvalidOperationException)
                    {
                        await Save(null, from, to, now.UtcDateTime, ex.Message, ct);
                    }
                    finally
                    {
                        if (isProbe) breaker.ReleaseProbe();
                    }
                }
            }
        }
        if (AccessRejected || cache is null || string.IsNullOrWhiteSpace(cache.SummaryJson)) return [];
        try
        {
            // Without an active connection, scheduled and in-progress rows can no longer be
            // revalidated and would read as current. Only frozen completed history remains, the
            // same set an explicit disconnect keeps.
            return Json.Read<List<TrainingSummaryItem>>(cache.SummaryJson).Select(Canonical)
                .Select(item => item with { AverageRpe = null, EffortRecordedSets = null, EffortTracked = null })
                .Where(item => item.LocalDate >= from && item.LocalDate <= to)
                .Where(item => connected || item.Status == "completed").ToList();
        }
        catch (Exception ex) when (ex is JsonException or DomainException) { return []; }
    }

    public static IReadOnlyList<TrainingSummaryItem> Merge(
        IReadOnlyList<TrainingSummaryItem> existing,
        IReadOnlyList<TrainingSummaryItem> incoming,
        DateOnly from,
        DateOnly to)
    {
        existing = existing.Select(Canonical).ToList();
        incoming = incoming.Select(Canonical).ToList();
        var incomingIds = incoming.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
        // Up-next days describe the active program as of one answer; an older answer's list is
        // never kept, even outside the refreshed range, or a passed day would linger as planned.
        var retained = existing.Where(item => item.Status != Upcoming).Where(item =>
            (item.LocalDate < from || item.LocalDate > to) ||
            (item.Status == "completed" && incomingIds.Contains(item.Id)))
            .ToList();
        var mergedById = retained.GroupBy(item => item.Id, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        foreach (var item in incoming)
        {
            // A completed snapshot is immutable from Nutrition's point of view. A later ranged
            // refresh may replace scheduled/in-progress rows, or promote one to completed, but
            // it must never rewrite an already-frozen completed record.
            if (mergedById.TryGetValue(item.Id, out var existingItem) && existingItem.Status == "completed")
            {
                var compatible = existingItem.WorkingSetCount == item.WorkingSetCount
                    && existingItem.ExternalVolumeKg == item.ExternalVolumeKg && existingItem.SystemVolumeKg == item.SystemVolumeKg;
                // New metadata cannot certify frozen figures that differ from a later peer correction.
                mergedById[item.Id] = existingItem with { CompletionDate = item.CompletionDate ?? existingItem.CompletionDate,
                    RepWorkingSets = compatible ? item.RepWorkingSets ?? existingItem.RepWorkingSets : existingItem.RepWorkingSets,
                    TimedWorkingSets = compatible ? item.TimedWorkingSets ?? existingItem.TimedWorkingSets : existingItem.TimedWorkingSets,
                    DurationSeconds = compatible ? item.DurationSeconds ?? existingItem.DurationSeconds : existingItem.DurationSeconds,
                    ExerciseMix = compatible ? item.ExerciseMix ?? existingItem.ExerciseMix : existingItem.ExerciseMix,
                    ExternalVolumeComplete = compatible ? item.ExternalVolumeComplete ?? existingItem.ExternalVolumeComplete : false,
                    SystemVolumeComplete = compatible ? item.SystemVolumeComplete ?? existingItem.SystemVolumeComplete : false,
                    ProgramWeek = item.ProgramWeek ?? existingItem.ProgramWeek,
                    ProgramPosition = item.ProgramPosition ?? existingItem.ProgramPosition };
                continue;
            }
            mergedById[item.Id] = item;
        }
        var merged = mergedById.Values.ToList();
        return merged.OrderBy(item => item.LocalDate).ThenBy(item => item.WorkoutName, StringComparer.Ordinal).ToList();
    }

    /// A planned day of Workout's active program: informational only, never training done.
    public const string Upcoming = "upcoming";

    private static TrainingSummaryItem Canonical(TrainingSummaryItem item)
    {
        var status = item.Status is "scheduled" or "in_progress" or "completed" or Upcoming
            ? item.Status
            : item.FinishedAt is not null ? "completed" : item.StartedAt is not null ? "in_progress" : "scheduled";
        var id = string.IsNullOrWhiteSpace(item.Id)
            ? $"legacy:{item.LocalDate:yyyy-MM-dd}:{item.WorkoutName}:{item.StartedAt:O}"
            : item.Id;
        return item with { Id = id, Status = status };
    }

    public async Task PurgeEphemeral(CancellationToken ct)
    {
        var row = await db.WorkoutSummaries.SingleOrDefaultAsync(ct);
        if (row is null) return;
        if (!string.IsNullOrWhiteSpace(row.SummaryJson))
        {
            var retained = Json.Read<List<TrainingSummaryItem>>(row.SummaryJson).Select(Canonical)
                .Where(item => item.Status == "completed").ToList();
            row.SummaryJson = Json.Write(retained);
        }
        row.LastError = "";
        row.LastErrorAt = null;
        row.Revision++;
        await db.SaveChangesAsync(ct);
    }

    private async Task Save(IReadOnlyList<TrainingSummaryItem>? items, DateOnly from, DateOnly to, DateTime now, string? error, CancellationToken ct, string? timeZone = null, int schemaVersion = 1)
    {
        try
        {
            var row = await db.WorkoutSummaries.SingleOrDefaultAsync(ct);
            if (row is null) { row = new WorkoutSummaryCache { UserId = db.CurrentUser!.Value }; db.WorkoutSummaries.Add(row); }
            if (items is not null)
            {
                var existing = string.IsNullOrWhiteSpace(row.SummaryJson) ? [] : Json.Read<List<TrainingSummaryItem>>(row.SummaryJson);
                // Effort is not persisted: a later preference change cannot leak historic RPE through fallback.
                row.SummaryJson = Json.Write(Merge(existing, items, from, to).Select(item => item with { AverageRpe = null, EffortRecordedSets = null, EffortTracked = null }).ToList());
                row.CoverageFrom = from; row.CoverageTo = to; row.CoverageTimeZone = timeZone ?? "UTC";
                row.SummarySchemaVersion = schemaVersion;
                row.LastSuccessAt = now; row.LastError = ""; row.LastErrorAt = null;
                row.Revision++; await db.SaveChangesAsync(ct);
            }
            else if (!string.IsNullOrWhiteSpace(error))
            {
                row.LastError = error; row.LastErrorAt = now;
                row.Revision++; await db.SaveChangesAsync(ct);
            }
        }
        catch (DbUpdateException) { /* Cached training is informational and never blocks Nutrition. */ }
    }
}
