namespace Nutrition.Api.Domain;

/// <summary>
/// The largest sustained change between consecutive seven-day intake blocks. A change of at least 15% and
/// 250 kcal/day, clear of day-to-day variation, moves glycogen and the water stored with it, which settles within about a week.
/// </summary>
public sealed record IntakeStep(DateOnly Date, double ChangeKcal)
{
    public const int SettleDays = 7;
    private const int MinimumChangeKcal = 250;
    private const double MinimumChangeShare = .15;
    private const int MinimumLoggedBefore = 4;
    // Five logged days after the candidate: a few high days at the very end are a spike, not a sustained change.
    private const int MinimumLoggedAfter = 5;
    private const double MinimumShiftedShare = .8;
    private const int BlockDays = 7;
    /// Days before the window start that <see cref="Largest"/> reads: the earliest candidate sits
    /// SettleDays - 1 before the start and its "before" block covers the BlockDays preceding it.
    public const int LookbackDays = SettleDays - 1 + BlockDays;

    /// <summary>Only changes whose settling period reaches into the window matter; earlier ones have already settled.</summary>
    public static IntakeStep? Largest(IEnumerable<NutritionDay> loggedDays, DateOnly start, DateOnly today)
    {
        var logged = loggedDays.GroupBy(day => day.Date).ToDictionary(group => group.Key, group => group.Last().Calories);
        IntakeStep? largest = null;
        for (var date = start.AddDays(-SettleDays + 1); date <= today.AddDays(-MinimumLoggedAfter); date = date.AddDays(1))
        {
            var before = Block(logged, date.AddDays(-BlockDays), date);
            var after = After(logged, date, today);
            if (before.Length < MinimumLoggedBefore || after.Length < MinimumLoggedAfter) continue;
            var change = after.Average() - before.Average();
            if (!Persisted(logged, date, before.Average(), after, change)) continue;
            if (Math.Abs(change) < Math.Max(MinimumChangeKcal, MinimumChangeShare * before.Average())) continue;
            // Alternate-day fasting or one fasting day swings block averages without a sustained change.
            if (Math.Abs(change) < 2 * Math.Sqrt(Variance(before) / before.Length + Variance(after) / after.Length)) continue;
            if (largest is null || Math.Abs(change) > Math.Abs(largest.ChangeKcal)) largest = new(date, change);
        }
        return largest;
    }

    /// <summary>
    /// A block average alone cannot tell a diet change from a short spike that happens to fill the end of the block.
    /// A real step starts on the candidate day itself and keeps nearly every later logged day past the midpoint
    /// between the two levels, which a run of high days after baseline days does not.
    /// </summary>
    private static bool Persisted(IReadOnlyDictionary<DateOnly, double> logged, DateOnly date, double beforeMean,
        IReadOnlyList<double> after, double change)
    {
        if (!logged.TryGetValue(date, out var onset)) return false;
        var midpoint = beforeMean + change / 2;
        bool Shifted(double value) => change > 0 ? value > midpoint : value < midpoint;
        return Shifted(onset) && after.Count(Shifted) >= Math.Ceiling(after.Count * MinimumShiftedShare);
    }

    /// <summary>
    /// The first seven logged days from the candidate, looking up to two weeks ahead. Unlogged days in the first
    /// week of a real change are skipped so later logs can still confirm it.
    /// </summary>
    private static double[] After(IReadOnlyDictionary<DateOnly, double> logged, DateOnly from, DateOnly today)
        => logged.Where(item => item.Key >= from && item.Key < today && item.Key < from.AddDays(2 * BlockDays))
            .OrderBy(item => item.Key).Take(BlockDays).Select(item => item.Value).ToArray();

    private static double Variance(IReadOnlyList<double> values)
    {
        var mean = values.Average();
        return values.Sum(value => (value - mean) * (value - mean)) / (values.Count - 1);
    }

    private static double[] Block(IReadOnlyDictionary<DateOnly, double> logged, DateOnly from, DateOnly to)
        => logged.Where(item => item.Key >= from && item.Key < to).Select(item => item.Value).ToArray();
}
