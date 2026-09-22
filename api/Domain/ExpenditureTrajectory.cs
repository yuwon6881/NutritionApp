namespace Nutrition.Api.Domain;

public sealed record TrajectoryPoint(
    DateOnly Date,
    double Expenditure,
    int? SuggestedCalories,
    double Confidence,
    string? HoldReason,
    double? Observed,
    double Gain,
    double TrendWeightKg,
    string EffectiveGoal,
    double GoalRatePercent);

public static class ExpenditureTrajectory
{
    public const string AlgorithmVersion = "v4-weight-context";

    public static TrajectoryPoint Calculate(
        Profile profile,
        DateOnly date,
        IReadOnlyList<NutritionDay> days,
        IReadOnlyList<WeightPoint> weights,
        double previousExpenditure)
    {
        var estimate = Expenditure.EstimateDaily(days, weights, previousExpenditure, date);
        var trendWeight = Coach.Trend(WeightContextPolicy.ForCalorieEstimation(weights)
                .Where(weight => weight.Date <= date).OrderBy(weight => weight.Date).ToArray())
            .LastOrDefault()?.Kg ?? profile.WeightKg;
        int? suggested = estimate.Adaptive
            ? SuggestedCalories(profile, estimate.Expenditure, trendWeight)
            : null;
        var rate = profile.GoalRatePercent ?? Coach.EffectiveGoalRate(profile, profile.Goal);
        return new(
            date,
            estimate.Expenditure,
            suggested,
            estimate.Evidence.Confidence,
            estimate.Adaptive ? null : estimate.Reason,
            estimate.Observed,
            estimate.Gain,
            trendWeight,
            profile.Goal,
            rate);
    }

    public static int SuggestedCalories(Profile profile, double expenditure, double trendWeightKg)
    {
        var change = profile.GoalRatePercent is {} rate
            ? trendWeightKg * rate / 100 * 7700 / 7
            : profile.Goal switch
            {
                "lose" => profile.EnergyAdjustmentPercent is {} deficit
                    ? -expenditure * deficit / 100
                    : -Math.Min(expenditure * .20, trendWeightKg * .005 * 7700 / 7),
                "gain" => profile.EnergyAdjustmentPercent is {} surplus
                    ? expenditure * surplus / 100
                    : Math.Min(expenditure * .10, trendWeightKg * .0015 * 7700 / 7),
                _ => 0
            };
        var rounded = Math.Round((expenditure + change) / 25, MidpointRounding.AwayFromZero) * 25;
        var floor = profile.GoalRatePercent is not null ? 1000 : Math.Ceiling(Math.Max(1500, expenditure * .75) / 25) * 25;
        return (int)Math.Max(rounded, floor);
    }
}
