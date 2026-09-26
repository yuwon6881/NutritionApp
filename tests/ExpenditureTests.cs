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
    public void Explicit_temporary_context_is_excluded_before_weight_signal_analysis()
    {
        var weights = Weights(i => i is >= 10 and <= 12 ? 81.5 : 80)
            .Select((weight, index) => weight with { Context = index is >= 10 and <= 12 ? "bloating" : null })
            .ToArray();

        var estimate = Expenditure.Estimate(Days(), weights, 2500, Today);

        Assert.Equal(25, estimate.Evidence.WeighIns);
        Assert.Equal(0, estimate.Evidence.WaterFlaggedDays);
        Assert.True(estimate.Adaptive);
        Assert.Contains("Based on 25 retained weigh-ins", estimate.Reason);
        Assert.Contains("Excluded 3 weigh-in days you marked as a possible temporary fluctuation", estimate.Reason);
    }

    [Fact]
    public void Temporary_context_can_leave_too_little_evidence_to_recalibrate()
    {
        var weights = Weights().Select((weight, index) => weight with
        {
            Context = index < 22 ? "stress" : null
        }).ToArray();

        var estimate = Expenditure.Estimate(Days(), weights, 2500, Today);

        Assert.False(estimate.Adaptive);
        Assert.Equal(6, estimate.Evidence.WeighIns);
        Assert.Contains("need eight retained weigh-ins", estimate.Reason);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("genuine_change")]
    [InlineData("unsure")]
    public void Unconfirmed_context_keeps_the_existing_statistical_filter(string? context)
    {
        var weights = Weights(i => i is >= 10 and <= 12 ? 81.5 : 80)
            .Select((weight, index) => weight with { Context = index is >= 10 and <= 12 ? context : null })
            .ToArray();

        var signal = WeightSignal.Analyze(weights, Today);

        Assert.True(signal.WaterFlaggedDays >= 3);
        Assert.Equal(25, signal.Retained.Count);
    }

    [Fact]
    public void Calorie_suggestion_uses_the_trend_without_temporary_weights()
    {
        var weights = Weights(i => i == 27 ? 84 : 80)
            .Select((weight, index) => weight with { Context = index == 27 ? "travel" : null })
            .ToArray();
        var profile = new Profile
        {
            Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4,
            Goal = "lose", Maintenance = 2500
        };

        var point = ExpenditureTrajectory.Calculate(profile, Today, Days(), weights, 2500);

        Assert.Equal(80, point.TrendWeightKg);
        Assert.Equal(ExpenditureTrajectory.SuggestedCalories(profile, point.Expenditure, 80), point.SuggestedCalories);
    }

    [Fact]
    public void Coaching_target_uses_the_weight_trend_without_temporary_entries()
    {
        var profile = new Profile
        {
            Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4,
            Goal = "lose", Maintenance = 2500, GoalRatePercent = -.8
        };
        var stable = Weights();
        var unusual = stable.Select((weight, index) => index == 27
            ? weight with { Kg = 100, Context = "stress" }
            : weight).ToArray();

        var expected = Coach.Calculate(profile, Days(), stable, null, Today);
        var actual = Coach.Calculate(profile, Days(), unusual, null, Today);

        Assert.Equal(expected.Expenditure, actual.Expenditure);
        Assert.Equal(expected.Calories, actual.Calories);
        Assert.Equal(expected.GoalProgress?.TrendWeight, actual.GoalProgress?.TrendWeight);
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

    [Fact]
    public void Daily_gain_matches_one_week_of_the_prior_gain()
    {
        const double weeklyGain = .25;
        var daily = Expenditure.DailyGain(weeklyGain);
        Assert.Equal(weeklyGain, 1 - Math.Pow(1 - daily, 7), 10);
    }

    [Fact]
    public void Daily_estimator_holds_the_previous_value_with_incomplete_evidence()
    {
        var estimate = Expenditure.EstimateDaily(Days(16), Weights(), 2400, Today);

        Assert.False(estimate.Adaptive);
        Assert.Equal(2400, estimate.Expenditure);
        Assert.Equal(0, estimate.Gain);
        Assert.Contains("60% coverage", estimate.Reason);
    }

    [Fact]
    public void Daily_estimator_includes_fasting_days_as_zero_intake()
    {
        var days = Days().Select(day => day.Date > Today.AddDays(-16)
            ? day with { Status = "fasting", Calories = 0 }
            : day).ToArray();

        var estimate = Expenditure.EstimateDaily(days, Weights(), 2400, Today);

        // Fasting days are intentional zero-intake days. They count toward coverage
        // and reduce mean intake proportionally, matching the accepted-plan estimator.
        Assert.Equal(28, estimate.Evidence.LoggedDays);
        Assert.Equal(1d, estimate.Evidence.Coverage, 10);
        Assert.InRange(estimate.Evidence.MeanIntake, 1160, 1162);
    }

    [Fact]
    public void Fasting_coverage_prevents_TDEE_inflation_from_excluding_zero_intake_days()
    {
        // With 5 eating days at 2500 kcal and 2 fasting days per week (14 eating + 14 fasting),
        // mean intake must reflect the fasting, not exclude it.
        var days = Days().Select((day, i) => i % 2 == 0
            ? day with { Status = "fasting", Calories = 0 }
            : day).ToArray();

        var estimate = Expenditure.Estimate(days, Weights(), 2400, Today);

        Assert.Equal(28, estimate.Evidence.LoggedDays);
        Assert.InRange(estimate.Evidence.MeanIntake, 1249, 1251); // (14 * 2500) / 28 ≈ 1250
    }
}
