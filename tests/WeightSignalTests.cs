using System.Text.Json;
using Nutrition.Api.Domain;
using Xunit;

namespace Nutrition.Tests;

public sealed class WeightSignalTests
{
    private static readonly DateOnly Today = new(2026, 9, 8);

    private static DateOnly Day(int index) => Today.AddDays(-28 + index);

    private static WeightPoint[] Weights(Func<int, double> value, Func<int, string?>? context = null)
        => Enumerable.Range(0, 28).Select(i => new WeightPoint(Day(i), value(i), context?.Invoke(i))).ToArray();

    private static NutritionDay[] Days(Func<int, double> calories)
        => Enumerable.Range(0, 28).Select(i => new NutritionDay(Day(i), "complete", calories(i))).ToArray();

    private static JsonElement Fixture([System.Runtime.CompilerServices.CallerFilePath] string source = "")
    {
        // The source path keeps the lookup working when tests build outside the repository.
        var directory = new DirectoryInfo(Path.GetDirectoryName(source) ?? AppContext.BaseDirectory);
        while (directory != null && !File.Exists(Path.Combine(directory.FullName, "tests", "fixtures", "weight-context.json")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        return JsonDocument.Parse(File.ReadAllText(Path.Combine(directory!.FullName, "tests", "fixtures", "weight-context.json"))).RootElement;
    }

    [Fact]
    public void Context_rules_match_the_shared_fixture()
    {
        var fixture = Fixture();
        var expected = fixture.GetProperty("contexts").EnumerateArray()
            .Select(item => (item.GetProperty("code").GetString(), item.GetProperty("temporary").GetBoolean(),
                item.GetProperty("settleDays").GetInt32(), item.GetProperty("direction").GetString()))
            .ToArray();
        var actual = WeightContextPolicy.Rules.Select(rule => ((string?)rule.Code, rule.Temporary, rule.SettleDays, (string?)rule.Direction)).ToArray();
        Assert.Equal(expected, actual);

        var policy = fixture.GetProperty("policy");
        Assert.Equal(WeightContextPolicy.ConfirmationDays, policy.GetProperty("confirmationDays").GetInt32());
        Assert.Equal(WeightContextPolicy.ConfirmingWeighIns, policy.GetProperty("confirmingWeighIns").GetInt32());
        Assert.Equal(WeightContextPolicy.ConfirmationToleranceKg, policy.GetProperty("confirmationToleranceKg").GetDouble());
        Assert.Equal(WeightContextPolicy.MaxAdjustedShare, policy.GetProperty("maxAdjustedShare").GetDouble());
        Assert.Equal(WeightSignal.HalfWindowDays, policy.GetProperty("outlierHalfWindowDays").GetInt32());
        Assert.Equal(WeightSignal.WideHalfWindowDays, policy.GetProperty("outlierWideHalfWindowDays").GetInt32());
        Assert.Equal(WeightSignal.MinNeighbours, policy.GetProperty("outlierMinNeighbours").GetInt32());
        Assert.Equal(WeightSignal.ThresholdSigma, policy.GetProperty("outlierThresholdSigma").GetDouble());
        Assert.Equal(WeightSignal.NoiseFloorKg, policy.GetProperty("outlierNoiseFloorKg").GetDouble());
        Assert.Equal(WeightSignal.MadScale, policy.GetProperty("madScale").GetDouble());
    }

    [Fact]
    public void Clean_trend_matches_the_shared_parity_cases()
    {
        foreach (var item in Fixture().GetProperty("trendCases").EnumerateArray())
        {
            var today = DateOnly.Parse(item.GetProperty("today").GetString()!);
            var weights = item.GetProperty("weights").EnumerateArray().Select(point => new WeightPoint(
                DateOnly.Parse(point.GetProperty("date").GetString()!), point.GetProperty("kg").GetDouble(),
                point.TryGetProperty("context", out var context) ? context.GetString() : null)).ToArray();
            var excluded = item.GetProperty("excludedDates").EnumerateArray().Select(date => DateOnly.Parse(date.GetString()!)).ToArray();
            var outliers = item.GetProperty("outlierDates").EnumerateArray().Select(date => DateOnly.Parse(date.GetString()!)).ToArray();

            var counted = WeightContextPolicy.ForCalorieEstimation(weights).Select(point => point.Date).ToArray();
            var clean = WeightSignal.CleanTrend(weights, today);

            Assert.Equal(excluded, weights.Select(point => point.Date).Except(counted).ToArray());
            Assert.Equal(outliers, counted.Except(clean.Select(point => point.Date)).ToArray());
            Assert.Equal(item.GetProperty("finalTrendKg").GetDouble(), clean[^1].Kg, 9);
        }
    }

    [Theory]
    [InlineData("high_sodium")]
    [InlineData("poor_sleep")]
    [InlineData("dehydration")]
    [InlineData("low_carb")]
    public void New_context_codes_are_valid_and_temporary(string code)
    {
        Assert.True(WeightContextPolicy.IsValid(code));
        Assert.True(WeightContextPolicy.IsTemporary(code));
    }

    [Fact]
    public void A_spike_does_not_leak_into_the_clean_trend()
    {
        var weights = Weights(i => i == 24 ? 82.5 : 80);

        var clean = WeightSignal.CleanTrend(weights, Today);
        var raw = Coach.Trend(weights);

        Assert.True(raw[^1].Kg > 80.1);
        Assert.Equal(80, clean[^1].Kg, 6);
        Assert.DoesNotContain(clean, point => point.Date == Day(24));
    }

    [Fact]
    public void A_genuine_level_shift_is_kept()
    {
        var signal = WeightSignal.Analyze(Weights(i => i < 14 ? 80 : 78.8), Today);

        Assert.Equal(0, signal.WaterFlaggedDays);
        Assert.Equal(28, signal.Retained.Count);
        Assert.True(signal.TheilSenSlopeKgPerDay < 0);
    }

    [Fact]
    public void Slope_uses_scale_weights_without_smoothing_lag()
    {
        var signal = WeightSignal.Analyze(Weights(i => 80 - .1 * i), Today);

        Assert.Equal(-.1, signal.TheilSenSlopeKgPerDay!.Value, 9);
        Assert.Equal(-.1, signal.EndpointSlopeKgPerDay!.Value, 9);
    }

    [Fact]
    public void Endpoint_slope_uses_the_median_dates_of_each_edge_week()
    {
        int[] days = [4, 5, 6, 10, 13, 16, 19, 21, 22, 23];
        var weights = days.Select(i => new WeightPoint(Day(i), 80 - .1 * i)).ToArray();

        var signal = WeightSignal.Analyze(weights, Today);

        Assert.Equal(-.1, signal.EndpointSlopeKgPerDay!.Value, 9);
    }

    [Fact]
    public void Days_after_a_salty_meal_are_down_weighted_while_water_settles()
    {
        double Value(int i) => i switch { 20 => 81.5, 21 => 80.4, 22 => 80.2, _ => 80 };
        double WeightOn(WeightSignalResult signal, int index)
            => signal.RetainedWeights[signal.Retained.ToList().FindIndex(point => point.Date == Day(index))];

        var salty = WeightSignal.Analyze(Weights(Value, i => i == 20 ? "high_sodium" : null), Today);
        var unexplained = WeightSignal.Analyze(Weights(Value, i => i == 20 ? "genuine_change" : null), Today);

        Assert.Equal(1, salty.ContextExcluded);
        Assert.Equal(2, salty.ContextSettling);
        Assert.Equal(1d / 3, WeightOn(salty, 21), 9);
        Assert.Equal(2d / 3, WeightOn(salty, 22), 9);
        Assert.Equal(1, WeightOn(salty, 23));
        Assert.Equal(1, WeightOn(unexplained, 21));
        Assert.Equal(0, unexplained.ContextSettling);
    }

    [Fact]
    public void A_marked_weigh_in_is_reinstated_when_later_weigh_ins_confirm_the_level()
    {
        var weights = Weights(i => i < 14 ? 80 : 81.2, i => i == 14 ? "stress" : null);

        var signal = WeightSignal.Analyze(weights, Today);
        var estimate = Expenditure.Estimate(Days(_ => 2500), weights, 2500, Today);

        Assert.Equal(0, signal.ContextExcluded);
        Assert.Equal(1, signal.ContextReinstated);
        Assert.Equal(1, estimate.Evidence.ContextReinstated);
        Assert.Contains("Counted 1 marked weigh-in day again because later weigh-ins stayed at that level", estimate.Reason);
    }

    [Fact]
    public void A_recent_marked_weigh_in_stays_excluded_until_later_weigh_ins_exist()
    {
        var signal = WeightSignal.Analyze(Weights(i => i == 26 ? 81.6 : 80, i => i == 26 ? "stress" : null), Today);

        Assert.Equal(1, signal.ContextExcluded);
        Assert.Equal(0, signal.ContextReinstated);
    }

    [Fact]
    public void Blanket_temporary_labels_cannot_hide_more_than_the_capped_share()
    {
        var weights = Weights(i => i % 2 == 1 ? 81.5 : 80, i => i % 2 == 1 ? "stress" : null);

        var signal = WeightSignal.Analyze(weights, Today);

        Assert.Equal(8, signal.ContextExcluded);
        Assert.Equal(6, signal.ContextReinstated);
    }

    [Fact]
    public void An_intake_change_holds_until_water_and_glycogen_settle()
    {
        var days = Days(i => i < 21 ? 2500 : 2000);
        var weights = Weights(i => i < 21 ? 80 : 80 - Math.Min(4, i - 20) * .2);

        var estimate = Expenditure.Estimate(days, weights, 2500, Today);

        Assert.False(estimate.Adaptive);
        Assert.Equal(2500, estimate.Expenditure);
        Assert.Contains("intake changed by about 500 kcal/day", estimate.Reason);
    }

    [Fact]
    public void After_an_intake_change_the_estimate_uses_only_the_settled_period()
    {
        var days = Days(i => i < 7 ? 3000 : 2500);
        var weights = Weights(i => i < 7 ? 80 : 80 - Math.Min(4, i - 6) * .25);

        var estimate = Expenditure.Estimate(days, weights, 2500, Today);

        Assert.True(estimate.Adaptive);
        Assert.Equal(14, estimate.Evidence.WindowDays);
        Assert.InRange(estimate.Expenditure, 2490, 2510);
        Assert.Contains("since your intake changed", estimate.Reason);
    }
}
