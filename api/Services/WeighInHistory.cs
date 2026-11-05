using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services;

public sealed record WeighInPage(IReadOnlyList<Weight> Items, bool HasMore);

/// <summary>
/// Older weigh-ins for the Progress history list, newest first. The progress summary
/// carries only the latest rows; the list pages backwards from the oldest row it shows
/// with a date cursor, so a long period never loads its whole history at once.
/// </summary>
public static class WeighInHistory
{
    public const int MaxPageSize = 60;

    public static async Task<WeighInPage> Page(AppDb db, DateOnly start, DateOnly before, int limit, CancellationToken ct)
    {
        var size = Math.Clamp(limit, 1, MaxPageSize);
        // One extra row answers "is there more?" without a second count query.
        var rows = await db.Weights.AsNoTracking()
            .Where(item => !item.Deleted && item.Date >= start && item.Date < before)
            .OrderByDescending(item => item.Date)
            .Take(size + 1)
            .ToListAsync(ct);
        return new WeighInPage(rows.Take(size).ToList(), rows.Count > size);
    }
}
