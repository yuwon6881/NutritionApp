using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

/// Reads weigh-ins for trend math with a bounded warm-up instead of every weigh-in ever recorded.
/// The trend is an EMA with a 7-day half-life, so a seed a year back weighs 0.5^52 ≈ 2e-16, below
/// double precision. Context exclusions and outlier flags look at most a week either side, so only
/// points within a week of the floor can be classified differently. A caller reports the earliest
/// date whose trend value or membership it read; when that falls inside the warm-up (a sparse
/// history), the complete history is read instead, so results never depend on the bound.
public static class WeightHistory
{
    public const int TrendWarmupDays = 365;
    private const int WarmupDays = TrendWarmupDays + WeightSignal.WideHalfWindowDays;

    /// Runs <paramref name="compute"/> over weigh-ins through <paramref name="end"/>. It returns its
    /// result and the earliest date it read, or null when it found too few points to be sure.
    public static async Task<T> Compute<T>(AppDb db, DateOnly from, DateOnly end,
        Func<IReadOnlyList<WeightPoint>, (T Result, DateOnly? Earliest)> compute, CancellationToken ct)
    {
        var dated = db.Weights.AsNoTracking().Where(w => !w.Deleted && w.Date <= end);
        var floor = from.AddDays(-WarmupDays);
        var (result, earliest) = compute(await Read(dated.Where(w => w.Date >= floor), ct));
        if (earliest >= from || !await dated.AnyAsync(w => w.Date < floor, ct)) return result;
        return compute(await Read(dated, ct)).Result;
    }

    private static Task<List<WeightPoint>> Read(IQueryable<Weight> weights, CancellationToken ct)
        => weights.OrderBy(w => w.Date).Select(w => new WeightPoint(w.Date, w.Kg, w.Context)).ToListAsync(ct);
}
