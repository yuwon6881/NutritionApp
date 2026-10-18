using Nutrition.Api.Domain;
using Xunit;

namespace Nutrition.Tests;

/// <summary>
/// Simulated diaries where the true expenditure is known, so each logging pattern can be checked against it.
/// Morning weight reflects intake through the previous day: tissue at 7,700 kcal/kg, plus glycogen water gained
/// after a high-intake day or lost after a very low one that settles with a 1.5-day half-life, plus a fixed
/// scale-noise pattern.
/// </summary>
public sealed class UnloggedDayScenarioTests
{
    private const double TrueExpenditure = 2500;
    private static readonly DateOnly First = new(2026, 6, 1); // a Monday
    private static readonly double[] Noise = [.2, -.1, .15, -.25, .05, .1, -.15, .25, -.05, -.2, .1, 0, .15, -.1];

    private sealed record Diary(NutritionDay[] Days, WeightPoint[] Weights);

    private static Diary Simulate(int length, Func<int, double> intake, Func<int, bool> logged, double waterKg = .4,
        Func<int, string>? status = null)
    {
        var days = new List<NutritionDay>();
        var weights = new List<WeightPoint>();
        double tissue = 80, water = 0;
        for (var day = 0; day < length; day++)
        {
            var date = First.AddDays(day);
            weights.Add(new WeightPoint(date, Math.Round(tissue + water + Noise[day % Noise.Length], 2)));
            var eaten = intake(day);
            if (logged(day)) days.Add(new NutritionDay(date, status?.Invoke(day) ?? "complete", eaten));
            tissue += (eaten - TrueExpenditure) / 7700;
            water = water * Math.Pow(.5, 1 / 1.5)
                + (eaten > TrueExpenditure + 500 ? waterKg : eaten < TrueExpenditure - 1000 ? -waterKg : 0);
        }
        return new(days.ToArray(), weights.ToArray());
    }

    /// <summary>Runs the daily estimate the way the trajectory does and returns the last estimate.</summary>
    private static ExpenditureEstimate Run(Diary diary, double start, int fromDay = 35, int toDay = 120)
    {
        var expenditure = start;
        ExpenditureEstimate? last = null;
        for (var day = fromDay; day <= toDay; day++)
        {
            var today = First.AddDays(day);
            last = Expenditure.EstimateDaily(diary.Days.Where(d => d.Date < today).ToArray(),
                diary.Weights.Where(w => w.Date <= today).ToArray(), expenditure, today);
            expenditure = last.Expenditure;
        }
        return last!;
    }

    private static bool Weekend(int day) => day % 7 is 5 or 6;

    /// <summary>The previous method: unlogged days dropped, so they implicitly ate like the average logged day.</summary>
    private static double LoggedOnlyObserved(Diary diary, DateOnly today)
    {
        var start = today.AddDays(-Expenditure.WindowDays);
        var mean = diary.Days.Where(d => d.Date >= start && d.Date < today).Average(d => d.Calories);
        return mean - 7700 * WeightSignal.Analyze(diary.Weights.Where(w => w.Date <= today).ToArray(), today).TheilSenSlopeKgPerDay!.Value;
    }

    [Fact]
    public void Unlogged_weekend_surplus_does_not_drive_the_estimate_down()
    {
        var diary = Simulate(121, day => Weekend(day) ? 3500 : 2000, day => !Weekend(day));

        var estimate = Run(diary, TrueExpenditure);

        // Dropping the weekends reads their weight gain as a ~400 kcal lower expenditure.
        Assert.InRange(LoggedOnlyObserved(diary, First.AddDays(120)), 1900, 2250);
        Assert.InRange(estimate.Expenditure, TrueExpenditure - 150, TrueExpenditure + 50);
        Assert.True(estimate.Evidence.UnloggedTrendGap > 0);
        Assert.Contains("probably held more food", estimate.Reason);
    }

    [Fact]
    public void Unlogged_weekend_surplus_still_lets_a_low_starting_estimate_rise()
    {
        var diary = Simulate(121, day => Weekend(day) ? 3500 : 2000, day => !Weekend(day));

        var estimate = Run(diary, 2100);

        Assert.True(estimate.Expenditure > 2100, $"expected a rise, got {estimate.Expenditure:0}");
    }

    [Fact]
    public void Unlogged_weekend_deficit_does_not_drive_the_estimate_up()
    {
        // Weekends eaten lightly but never logged (for example an unmarked fast) hide a deficit instead.
        var diary = Simulate(121, day => Weekend(day) ? 1000 : 2600, day => !Weekend(day));

        var estimate = Run(diary, TrueExpenditure);

        Assert.InRange(LoggedOnlyObserved(diary, First.AddDays(120)), 2750, 3200);
        Assert.InRange(estimate.Expenditure, TrueExpenditure - 50, TrueExpenditure + 150);
        Assert.Contains("probably held less food", estimate.Reason);
    }

    [Fact]
    public void A_modest_unlogged_weekend_surplus_without_water_is_named_for_the_user()
    {
        // Without a next-morning water jump four weeks of scale noise cannot isolate the weekends, so no hold is
        // justified and the estimate stays low; the reason names the pattern so the user can log those days.
        var diary = Simulate(181, day => Weekend(day) ? 3200 : 2200, day => !Weekend(day), waterKg: 0);

        var estimate = Run(diary, TrueExpenditure, toDay: 180);
        var loggedOnly = LoggedOnlyObserved(diary, First.AddDays(180));

        Assert.True(estimate.Adaptive, estimate.Reason);
        Assert.True(estimate.Expenditure > loggedOnly, $"{estimate.Expenditure:0} vs {loggedOnly:0}");
        Assert.Contains("Most unlogged days fell on Saturdays and Sundays", estimate.Reason);
        Assert.True(estimate.Expenditure < TrueExpenditure);
    }

    [Fact]
    public void Unlogged_days_eaten_like_logged_days_keep_the_estimate_unbiased_and_adaptive()
    {
        // About one day in four is skipped at random, eaten at the same deficit as logged days.
        int[] skipped = [2, 6, 9, 13, 18, 20, 24, 29, 31, 37, 40, 44, 47, 52, 55, 61, 65, 68, 72, 76, 79, 85, 88, 93, 97, 100, 104, 109, 113, 117];
        var diary = Simulate(121, _ => 2000, day => !skipped.Contains(day));

        var estimate = Run(diary, 2300);

        Assert.True(estimate.Adaptive, estimate.Reason);
        Assert.Null(estimate.Evidence.UnloggedTrendGap);
        Assert.InRange(estimate.Expenditure, 2400, 2600);
        Assert.Contains("unlogged days count at about", estimate.Reason);
        Assert.DoesNotContain("Most unlogged days", estimate.Reason);
    }

    [Fact]
    public void An_unlogged_day_without_weigh_ins_around_it_counts_at_the_current_estimate()
    {
        var today = First.AddDays(40);
        var weights = Enumerable.Range(0, 41).Where(day => day % 2 == 0)
            .Select(day => new WeightPoint(First.AddDays(day), 80)).ToArray();
        var trend = WeightSignal.CleanTrend(weights, today);
        var logged = Enumerable.Range(0, 40).Where(day => day != 39).Select(day => First.AddDays(day)).ToHashSet();

        // The last day has a weigh-in only before it, so it carries no trend evidence.
        var lastOpen = UnloggedIntake.Estimate(trend.Where(point => point.Date < First.AddDays(40)).ToArray(),
            today.AddDays(-28), today, logged, 2400);

        Assert.Equal(1, lastOpen.Days);
        Assert.Equal(2400, lastOpen.TotalKcal, 6);
    }

    [Fact]
    public void A_long_unlogged_holiday_surplus_is_mostly_recovered_from_the_trend()
    {
        // Ten unlogged holiday days at +1,000 kcal inside an otherwise fully logged maintenance diary.
        var diary = Simulate(70, day => day is >= 40 and < 50 ? 3500 : 2500, day => day is < 40 or >= 50);

        var today = First.AddDays(62);
        var estimate = Expenditure.Estimate(diary.Days, diary.Weights, TrueExpenditure, today);

        Assert.Equal(10, estimate.Evidence.UnloggedDays);
        Assert.InRange(estimate.Evidence.UnloggedMeanIntake!.Value, 3000, 3700);
        Assert.InRange(estimate.Observed ?? estimate.Expenditure, TrueExpenditure - 250, TrueExpenditure + 250);
        Assert.InRange(LoggedOnlyObserved(diary, today), 1900, 2300);
    }

    [Fact]
    public void Too_many_unlogged_days_hold_instead_of_guessing()
    {
        var diary = Simulate(70, _ => 2500, day => day is < 30 or >= 42);

        var estimate = Expenditure.Estimate(diary.Days, diary.Weights, TrueExpenditure, First.AddDays(56));

        Assert.False(estimate.Adaptive);
        Assert.Contains("60% coverage", estimate.Reason);
    }

    [Fact]
    public void Explicit_fasting_days_count_as_zero_rather_than_being_estimated()
    {
        var diary = Simulate(121, day => day % 7 == 2 ? 0 : 2900, _ => true, status: day => day % 7 == 2 ? "fasting" : "complete");

        var estimate = Run(diary, 2300);

        Assert.Equal(0, estimate.Evidence.UnloggedDays);
        Assert.Equal(0, estimate.Evidence.LowLoggedDays);
        Assert.InRange(estimate.Expenditure, 2400, 2600);
    }

    [Fact]
    public void Partly_logged_days_are_reported_without_being_dropped()
    {
        var diary = Simulate(70, day => day % 9 == 4 ? 700 : 2500, _ => true);

        var estimate = Expenditure.Estimate(diary.Days, diary.Weights, TrueExpenditure, First.AddDays(60));

        Assert.Equal(3, estimate.Evidence.LowLoggedDays);
        Assert.Equal(0, estimate.Evidence.UnloggedDays);
        Assert.Contains("3 logged days were under half your usual logged intake", estimate.Reason);
        Assert.Contains("Not fully logged", estimate.Reason);
    }
}
