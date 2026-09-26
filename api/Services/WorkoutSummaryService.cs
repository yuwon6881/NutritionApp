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
    double? AverageRpe);

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

public sealed class WorkoutSummaryService(AppDb db, IHttpClientFactory clients, IConfiguration config, IntegrationTokenService? peerTokens = null)
{
    private static readonly ConcurrentDictionary<string, WorkoutCircuitBreaker> Breakers = new(StringComparer.OrdinalIgnoreCase);

    public static WorkoutCircuitBreaker GetBreaker(string endpoint) => Breakers.GetOrAdd(endpoint, _ => new WorkoutCircuitBreaker());
    public static void ResetBreakers() => Breakers.Clear();

    /// Reads that block the main Nutrition state stay short so Workout never delays the diary.
    public static readonly TimeSpan InlineDeadline = TimeSpan.FromSeconds(2);
    /// Dedicated summary refreshes may wait out a scale-to-zero cold start of Workout, whose
    /// handler also validates the connection with Fitness Account before answering.
    public static readonly TimeSpan RefreshDeadline = TimeSpan.FromSeconds(8);

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
        TimeSpan? deadline = null, TimeProvider? timeProvider = null)
    {
        var cache = await db.WorkoutSummaries.AsNoTracking().SingleOrDefaultAsync(ct);
        var url = config["Integrations:WorkoutTrainingSummaryUrl"];
        var connected = await IsConnected(ct);
        var clock = timeProvider ?? TimeProvider.System;
        var now = clock.GetUtcNow();

        if (connected)
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
                            await Save(null, from, to, now.UtcDateTime, "Workout access is unauthorized.", ct);
                        }
                        else
                        {
                            response.EnsureSuccessStatusCode();
                            var items = (await response.Content.ReadFromJsonAsync<List<TrainingSummaryItem>>(cancellationToken: timeout.Token) ?? [])
                                .Select(Canonical).ToList();
                            breaker.RecordSuccess();
                            await Save(items, from, to, now.UtcDateTime, null, ct);
                            return items;
                        }
                    }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                    {
                        breaker.RecordFailure(clock.GetUtcNow());
                        await Save(null, from, to, now.UtcDateTime, "Workout summaries are temporarily unavailable.", ct);
                    }
                    catch (HttpRequestException ex) when (ex.StatusCode is null || (int)ex.StatusCode >= 500)
                    {
                        breaker.RecordFailure(clock.GetUtcNow());
                        await Save(null, from, to, now.UtcDateTime, ex.Message, ct);
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
        if (cache is null || string.IsNullOrWhiteSpace(cache.SummaryJson)) return [];
        try
        {
            // Without an active connection, scheduled and in-progress rows can no longer be
            // revalidated and would read as current. Only frozen completed history remains, the
            // same set an explicit disconnect keeps.
            return Json.Read<List<TrainingSummaryItem>>(cache.SummaryJson).Select(Canonical)
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
        var retained = existing.Where(item =>
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
                continue;
            mergedById[item.Id] = item;
        }
        var merged = mergedById.Values.ToList();
        return merged.OrderBy(item => item.LocalDate).ThenBy(item => item.WorkoutName, StringComparer.Ordinal).ToList();
    }

    private static TrainingSummaryItem Canonical(TrainingSummaryItem item)
    {
        var status = item.Status is "scheduled" or "in_progress" or "completed"
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

    private async Task Save(IReadOnlyList<TrainingSummaryItem>? items, DateOnly from, DateOnly to, DateTime now, string? error, CancellationToken ct)
    {
        try
        {
            var row = await db.WorkoutSummaries.SingleOrDefaultAsync(ct);
            if (row is null) { row = new WorkoutSummaryCache { UserId = db.CurrentUser!.Value }; db.WorkoutSummaries.Add(row); }
            if (items is not null)
            {
                var existing = string.IsNullOrWhiteSpace(row.SummaryJson) ? [] : Json.Read<List<TrainingSummaryItem>>(row.SummaryJson);
                row.SummaryJson = Json.Write(Merge(existing, items, from, to));
                row.LastSuccessAt = now; row.LastError = ""; row.LastErrorAt = null;
            }
            else { row.LastError = error ?? "Workout summary unavailable."; row.LastErrorAt = now; }
            row.Revision++; await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) { /* Cached training is informational and never blocks Nutrition. */ }
    }
}
