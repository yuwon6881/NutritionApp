namespace Nutrition.Api.Domain;

/// <summary>What the cleaned weight trend says about the window's unlogged days.</summary>
/// <param name="Days">Unlogged days inside the window.</param>
/// <param name="TotalKcal">Estimated intake summed over those days.</param>
/// <param name="TrendGapKcal">
/// How much more energy per day the trend gained across unlogged days than across logged days; null without
/// enough trend evidence on both sides. Positive means the unlogged days probably held more food.
/// </param>
public sealed record UnloggedIntakeEstimate(int Days, double TotalKcal, double? TrendGapKcal)
{
    public double? MeanKcal => Days == 0 ? null : TotalKcal / Days;
    /// One or two weekdays holding most unlogged days, such as an untracked weekend; empty when there is no pattern.
    public IReadOnlyList<DayOfWeek> RecurringWeekdays { get; init; } = [];
}

/// <summary>
/// An unlogged day still happened. Leaving it out silently treats it as an average logged day, so a weekend that
/// is never logged but eaten above the weekdays reads its weight gain as a lower expenditure. Instead each unlogged
/// day is estimated from the current expenditure plus the energy the cleaned trend stored or released across it
/// (the next morning's trend minus that morning's), which is how MacroFactor documents its handling. The trend
/// lags, so this recovers only part of a hidden surplus; the trend gap reports what may remain.
/// </summary>
public static class UnloggedIntake
{
    public const double KcalPerKg = 7700;
    private const int MinimumUnloggedWithTrend = 3;
    private const int MinimumLoggedWithTrend = 7;
    private const double MinimumGapKcal = 250;
    private const int MinimumRecurringDays = 4;
    private const double RecurringShare = .75;

    public static UnloggedIntakeEstimate Estimate(IReadOnlyList<WeightPoint> trend, DateOnly start, DateOnly end,
        IReadOnlySet<DateOnly> loggedDates, double expenditure)
    {
        var unlogged = new List<DateOnly>();
        var unloggedChanges = new List<double>();
        var loggedChanges = new List<double>();
        var total = 0d;
        for (var date = start; date < end; date = date.AddDays(1))
        {
            var change = TrendChange(trend, date);
            if (loggedDates.Contains(date))
            {
                if (change is {} logged) loggedChanges.Add(logged);
                continue;
            }
            if (change is {} kg) unloggedChanges.Add(kg);
            // Without trend on both mornings the day carries no evidence, so it counts at the current estimate.
            unlogged.Add(date);
            total += Math.Clamp(expenditure + KcalPerKg * (change ?? 0), 0, 2 * expenditure);
        }
        double? gap = unloggedChanges.Count >= MinimumUnloggedWithTrend && loggedChanges.Count >= MinimumLoggedWithTrend
            ? KcalPerKg * (unloggedChanges.Average() - loggedChanges.Average())
            : null;
        // The gap is kept only when it is large and clear of day-to-day trend variation.
        if (gap is {} value && Math.Abs(value) < Math.Max(MinimumGapKcal, 2 * KcalPerKg * StandardError(unloggedChanges, loggedChanges)))
            gap = null;
        return new(unlogged.Count, total, gap) { RecurringWeekdays = Recurring(unlogged) };
    }

    /// <summary>
    /// Trend change from the morning of <paramref name="date"/> to the next morning, which reflects that day's
    /// intake. The trend is interpolated between weigh-ins; days outside the weighed span have no evidence.
    /// </summary>
    private static double? TrendChange(IReadOnlyList<WeightPoint> trend, DateOnly date)
    {
        if (trend.Count < 2 || date < trend[0].Date || date.AddDays(1) > trend[^1].Date) return null;
        return TrendAt(trend, date.AddDays(1)) - TrendAt(trend, date);
    }

    private static double TrendAt(IReadOnlyList<WeightPoint> trend, DateOnly date)
    {
        for (var i = 1; i < trend.Count; i++)
        {
            if (trend[i].Date < date) continue;
            var previous = trend[i - 1];
            var span = trend[i].Date.DayNumber - previous.Date.DayNumber;
            if (span == 0) return trend[i].Kg;
            var share = (date.DayNumber - previous.Date.DayNumber) / (double)span;
            return previous.Kg + share * (trend[i].Kg - previous.Kg);
        }
        return trend[^1].Kg;
    }

    private static IReadOnlyList<DayOfWeek> Recurring(IReadOnlyList<DateOnly> unlogged)
    {
        if (unlogged.Count < MinimumRecurringDays) return [];
        var top = unlogged.GroupBy(date => date.DayOfWeek).OrderByDescending(group => group.Count()).Take(2).ToArray();
        if (top.Sum(group => group.Count()) < RecurringShare * unlogged.Count) return [];
        // A second weekday joins only when it recurs too, so "Saturdays" is not reported as "Saturdays and Tuesdays".
        return top.Where(group => group.Count() >= 2).Select(group => group.Key).OrderBy(day => ((int)day + 6) % 7).ToArray();
    }

    private static double StandardError(IReadOnlyList<double> first, IReadOnlyList<double> second)
        => Math.Sqrt(Variance(first) / first.Count + Variance(second) / second.Count);

    private static double Variance(IReadOnlyList<double> values)
    {
        var mean = values.Average();
        return values.Sum(value => (value - mean) * (value - mean)) / (values.Count - 1);
    }
}
