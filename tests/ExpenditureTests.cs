using Nutrition.Api.Domain;
using Xunit;

namespace Nutrition.Tests;

public sealed class ExpenditureTests
{
    private static readonly DateOnly Today = new(2026, 9, 8);

    private static NutritionDay[] Days(int count = 28, double calories = 2500)
        => Enumerable.Range(1, count)
            .Select(i => new NutritionDay(Today.AddDays(-i), "complete", calories))
            .OrderBy(day => day.Date).ToArray();

    private static WeightPoint[] Weights(Func<int, double>? value = null)
        => Enumerable.Range(0, 28)
            .Select(i => new WeightPoint(Today.AddDays(-28 + i), value?.Invoke(i) ?? 80))
            .ToArray();

    [Fact]
    public void One_missed_logging_day_does_not_reset_the_fixed_window()
    {
        var days = Days().Where(day => day.Date != Today.AddDays(-10)).ToArray();

        var estimate = Expenditure.Estimate(days, Weights(), 2500, Today);

        Assert.True(estimate.Adaptive);
        Assert.Equal(27, estimate.Evidence.LoggedDays);
        Assert.Equal(27d / 28, estimate.Evidence.Coverage, 10);
    }

    [Fact]
    public void Coverage_below_sixty_percent_holds_the_estimate()
    {
        var estimate = Expenditure.Estimate(Days(16), Weights(), 2500, Today);

        Assert.False(estimate.Adaptive);
        Assert.Equal(16, estimate.Evidence.LoggedDays);
        Assert.Contains("60% coverage", estimate.Reason);
    }

    [Fact]
    public void A_three_day_water_plateau_is_flagged_without_changing_the_estimate_much()
    {
        var estimate = Expenditure.Estimate(Days(), Weights(i => i is >= 10 and <= 12 ? 81.5 : 80), 2500, Today);

        Assert.True(estimate.Evidence.WaterFlaggedDays >= 3);
        Assert.True(estimate.Adaptive);
        Assert.InRange(estimate.Expenditure, 2485, 2500);
    }

    [Fact]
    public void Endpoint_and_Theil_Sen_disagreement_holds_adaptation()
    {
        var signal = WeightSignal.Analyze(Weights(i => i < 19 ? 80 : 82), Today);
        var estimate = Expenditure.Estimate(Days(), Weights(i => i < 19 ? 80 : 82), 2500, Today);

        Assert.NotNull(signal.TheilSenSlopeKgPerDay);
        Assert.NotNull(signal.EndpointSlopeKgPerDay);
        Assert.False(estimate.Adaptive,
            $"theil={signal.TheilSenSlopeKgPerDay} endpoint={signal.EndpointSlopeKgPerDay} flagged={signal.WaterFlaggedDays} retained={signal.Retained.Count} reason={estimate.Reason}");
        Assert.Contains("slopes disagree", estimate.Reason);
    }

    [Fact]
    public void Gain_is_smaller_for_sparse_weigh_ins()
    {
        var sparseDates = new HashSet<DateOnly>
        {
            Today.AddDays(-28), Today.AddDays(-24), Today.AddDays(-20), Today.AddDays(-16),
            Today.AddDays(-12), Today.AddDays(-8), Today.AddDays(-4), Today.AddDays(-1)
        };
        var sparse = Weights().Where(weight => sparseDates.Contains(weight.Date)).ToArray();
        var denseEstimate = Expenditure.Estimate(Days(), Weights(), 2400, Today);
        var sparseEstimate = Expenditure.Estimate(Days(), sparse, 2400, Today);

        Assert.True(denseEstimate.Adaptive);
        Assert.True(sparseEstimate.Adaptive);
        Assert.True(denseEstimate.Gain > sparseEstimate.Gain);
        Assert.Equal(8, sparseEstimate.Evidence.WeighIns);
    }

    [Fact]
    public void The_weekly_target_clamp_still_limits_a_large_valid_update()
    {
        var result = Coach.Calculate(
            new Profile { Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4, Goal = "maintain", Maintenance = 2500 },
            Days(calories: 3500), Weights(), new PreviousPlan(2500, 2500), Today);

        Assert.Equal(2750, result.Expenditure);
        Assert.Equal(2600, result.Calories);
    }

    [Fact]
    public void Observations_outside_the_supported_range_are_rejected()
    {
        var estimate = Expenditure.Estimate(Days(calories: 8000), Weights(), 2500, Today);

        Assert.False(estimate.Adaptive);
        Assert.Equal(8000, estimate.Observed);
        Assert.Equal(2500, estimate.Expenditure);
        Assert.Contains("outside the supported range", estimate.Reason);
    }
}
