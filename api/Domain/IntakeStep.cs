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
    private const int MinimumLoggedPerBlock = 4;

    /// <summary>Only changes whose settling period reaches into the window matter; earlier ones have already settled.</summary>
    public static IntakeStep? Largest(IEnumerable<NutritionDay> loggedDays, DateOnly start, DateOnly today)
    {
        var logged = loggedDays.GroupBy(day => day.Date).ToDictionary(group => group.Key, group => group.Last().Calories);
        IntakeStep? largest = null;
        for (var date = start.AddDays(-SettleDays + 1); date <= today.AddDays(-MinimumLoggedPerBlock); date = date.AddDays(1))
        {
            var before = Block(logged, date.AddDays(-7), date);
            var after = Block(logged, date, date.AddDays(7) < today ? date.AddDays(7) : today);
            if (before.Length < MinimumLoggedPerBlock || after.Length < MinimumLoggedPerBlock) continue;
            var change = after.Average() - before.Average();
            if (Math.Abs(change) < Math.Max(MinimumChangeKcal, MinimumChangeShare * before.Average())) continue;
            // Alternate-day fasting or one fasting day swings block averages without a sustained change.
            if (Math.Abs(change) < 2 * Math.Sqrt(Variance(before) / before.Length + Variance(after) / after.Length)) continue;
            if (largest is null || Math.Abs(change) > Math.Abs(largest.ChangeKcal)) largest = new(date, change);
        }
        return largest;
    }

    private static double Variance(IReadOnlyList<double> values)
    {
        var mean = values.Average();
        return values.Sum(value => (value - mean) * (value - mean)) / (values.Count - 1);
    }

    private static double[] Block(IReadOnlyDictionary<DateOnly, double> logged, DateOnly from, DateOnly to)
        => logged.Where(item => item.Key >= from && item.Key < to).Select(item => item.Value).ToArray();
}
