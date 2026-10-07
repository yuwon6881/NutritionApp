using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services;

/// The in-flight count and newest failed or unknown row of one upload queue.
internal sealed record GoogleHealthSyncWorkSummary(int Pending, string? ProblemState, string? ProblemCategory, string? ProblemMessage);

/// Status rules shared by the weight, nutrition, and body-fat upload queues. Succeeded rows are
/// kept as the local-to-Google mapping, so the queue grows with history; status must be read as
/// a count and one row rather than by loading every row.
internal static class GoogleHealthSyncStatus
{
    public static async Task<GoogleHealthSyncWorkSummary> SummarizeAsync<T>(IQueryable<T> work, CancellationToken ct)
        where T : class, IGoogleHealthSyncWork
    {
        var pending = await work.CountAsync(x => GoogleHealthSyncLeases.Claimable.Contains(x.ProcessingState), ct);
        var problem = await work.AsNoTracking()
            .Where(x => x.ProcessingState == "failed" || x.ProcessingState == "unknown")
            .OrderByDescending(x => x.UpdatedAt)
            .Select(x => new { x.ProcessingState, x.LastErrorCategory, x.LastErrorMessage })
            .FirstOrDefaultAsync(ct);
        return new(pending, problem?.ProcessingState, problem?.LastErrorCategory, problem?.LastErrorMessage);
    }

    public static string State(bool enabled, string connectionStatus, GoogleHealthSyncWorkSummary summary)
        => !enabled ? "disabled"
            : connectionStatus == "reconnect_required" ? "reconnect_required"
            : summary.ProblemState ?? (summary.Pending > 0 ? "pending" : "idle");
}
