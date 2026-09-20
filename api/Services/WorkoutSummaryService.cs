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

public sealed class WorkoutSummaryService(AppDb db, IHttpClientFactory clients, IConfiguration config, IntegrationTokenService? peerTokens = null)
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(2);

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

    public async Task<IReadOnlyList<TrainingSummaryItem>> Get(DateOnly from, DateOnly to, CancellationToken ct)
    {
        var cache = await db.WorkoutSummaries.AsNoTracking().SingleOrDefaultAsync(ct);
        var url = config["Integrations:WorkoutTrainingSummaryUrl"];
        var connected = await IsConnected(ct);
        if (connected)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(url))
                    throw new InvalidOperationException("Workout summary endpoint is not configured.");
                string? token;
                if (peerTokens is null)
                {
                    token = config["Integrations:WorkoutAccessToken"];
                }
                else
                {
                    using var tokenTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    tokenTimeout.CancelAfter(TimeSpan.FromSeconds(10));
                    token = await peerTokens.AccessToken("workout", "workout.training_summary.read", tokenTimeout.Token);
                }
                if (peerTokens is not null && string.IsNullOrWhiteSpace(token))
                    throw new InvalidOperationException("Workout access is temporarily unavailable.");

                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(Timeout);
                var separator = url.Contains('?') ? '&' : '?';
                using var request = new HttpRequestMessage(HttpMethod.Get, $"{url}{separator}from={from:yyyy-MM-dd}&to={to:yyyy-MM-dd}");
                if (!string.IsNullOrWhiteSpace(token)) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                var response = await clients.CreateClient("workout").SendAsync(request, timeout.Token);
                response.EnsureSuccessStatusCode();
                var items = (await response.Content.ReadFromJsonAsync<List<TrainingSummaryItem>>(cancellationToken: timeout.Token) ?? [])
                    .Select(Canonical).ToList();
                await Save(items, from, to, DateTime.UtcNow, null, ct);
                return items;
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                await Save(null, from, to, DateTime.UtcNow, "Workout summaries are temporarily unavailable.", ct);
            }
            catch (Exception ex) when (ex is HttpRequestException or JsonException or InvalidOperationException)
            {
                await Save(null, from, to, DateTime.UtcNow, ex.Message, ct);
            }
        }
        if (cache is null || string.IsNullOrWhiteSpace(cache.SummaryJson)) return [];
        try
        {
            return Json.Read<List<TrainingSummaryItem>>(cache.SummaryJson).Select(Canonical)
                .Where(item => item.LocalDate >= from && item.LocalDate <= to).ToList();
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
        var retained = existing.Where(item => item.Status == "completed" || item.LocalDate < from || item.LocalDate > to)
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
