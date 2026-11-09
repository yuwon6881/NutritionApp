using Nutrition.Api.Domain;
using Xunit;

namespace Nutrition.Tests;

/// <summary>
/// Fully logged simulated diaries with a known true expenditure: whatever the starting estimate, the daily estimator
/// must move toward the truth from intake and weight alone, and follow a later change in the true expenditure.
/// </summary>
public sealed class ExpenditureConvergenceTests
{
    private static readonly DateOnly First = new(2026, 6, 1);
    private static readonly double[] WeightNoise = [.2, -.1, .15, -.25, .05, .1, -.15, .25, -.05, -.2, .1, 0, .15, -.1];
    private static readonly double[] IntakeNoise = [60, -120, 90, -30, 150, -80, 20, -150, 100, -40];

    private static (NutritionDay[] Days, WeightPoint[] Weights) Simulate(int length, Func<int, double> trueExpenditure, double meanIntake)
    {
        var days = new List<NutritionDay>();
        var weights = new List<WeightPoint>();
        double tissue = 80;
        for (var day = 0; day < length; day++)
        {
            var date = First.AddDays(day);
            weights.Add(new WeightPoint(date, Math.Round(tissue + WeightNoise[day % WeightNoise.Length], 2)));
            var eaten = meanIntake + IntakeNoise[day % IntakeNoise.Length];
            days.Add(new NutritionDay(date, "complete", eaten));
            tissue += (eaten - trueExpenditure(day)) / 7700;
        }
        return (days.ToArray(), weights.ToArray());
    }

    private static double Run((NutritionDay[] Days, WeightPoint[] Weights) diary, double start, int toDay)
    {
        var expenditure = start;
        for (var day = 28; day <= toDay; day++)
        {
            var today = First.AddDays(day);
            expenditure = Expenditure.EstimateDaily(diary.Days.Where(d => d.Date < today).ToArray(),
                diary.Weights.Where(w => w.Date <= today).ToArray(), expenditure, today).Expenditure;
        }
        return expenditure;
    }

    [Theory]
    [InlineData(2000)]
    [InlineData(3400)]
    public void A_wrong_starting_estimate_converges_to_the_true_expenditure(double start)
    {
        var diary = Simulate(150, _ => 2700, 2400);

        Assert.InRange(Run(diary, start, 149), 2550, 2850);
    }

    [Fact]
    public void The_estimate_follows_a_later_change_in_true_expenditure()
    {
        // Expenditure falls 300 kcal/day on day 70 (for example, less daily movement) while intake stays the same.
        var diary = Simulate(180, day => day < 70 ? 2700 : 2400, 2400);

        var before = Run(diary, 2700, 69);
        var after = Run(diary, 2700, 179);

        Assert.InRange(before, 2550, 2850);
        Assert.InRange(after, 2300, 2520);
    }
}
