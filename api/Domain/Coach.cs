namespace Nutrition.Api.Domain;

public sealed record Profile
{
    public int Age { get; init; }
    public double HeightCm { get; init; }
    public double WeightKg { get; init; }
    public string Sex { get; init; } = "";
    public double Activity { get; init; }
    public string Goal { get; init; } = "";
    public double? Maintenance { get; init; }
    public double? ProteinGrams { get; init; }
    public string PhaseMode { get; init; } = "open";
    public DateOnly? PhaseStart { get; init; }
    public int? DurationWeeks { get; init; }
    public double? TargetWeightKg { get; init; }
    public double? PhaseStartWeightKg { get; init; }
    public double? EnergyAdjustmentPercent { get; init; }
    public bool ResistanceTraining { get; init; }
    public bool PregnancyOrBreastfeeding { get; init; }
    public bool MedicalNutrition { get; init; }
    public string TimeZone { get; init; } = "Asia/Kuala_Lumpur";
}
public record WeightPoint(DateOnly Date, double Kg);
public record NutritionDay(DateOnly Date, string Status, double Calories);
public record PreviousPlan(double Calories, double Expenditure, bool PhaseComplete = false);
public record CoachResult(bool Eligible, bool Adaptive, double? Calories, double? Expenditure,
    double? Protein, double? Fat, double? Carbs, string Explanation, string Version = Coach.Version)
{
    public string EffectiveGoal { get; init; } = "maintain";
    public bool PhaseComplete { get; init; }
    public GoalProgress? GoalProgress { get; init; }
}

public static class Coach
{
    public const string Version = "1.1.0";
    public static double Resting(Profile p) => 10 * p.WeightKg + 6.25 * p.HeightCm - 5 * p.Age + (p.Sex == "male" ? 5 : -161);

    public static CoachResult Calculate(Profile p, IReadOnlyList<NutritionDay> days,
        IReadOnlyList<WeightPoint> weights, PreviousPlan? previous, DateOnly today, double? startingExpenditure = null, bool allowAdaptation = true)
    {
        if (p.Age < 18 || p.PregnancyOrBreastfeeding || p.MedicalNutrition)
            return Blocked("Automated targets are unavailable for this profile. You can still keep a food and weight diary.");
        var progress = GoalPolicy.Evaluate(p, weights, today, previous?.PhaseComplete == true);
        var currentWeight = Trend(weights.Where(w => w.Date <= today).ToArray()).LastOrDefault()?.Kg ?? p.WeightKg;
        p = p with { WeightKg = currentWeight };
        var effectiveGoal = progress.Complete ? "maintain" : p.Goal;
        if (effectiveGoal == "lose" && p.WeightKg / Math.Pow(p.HeightCm / 100, 2) < 18.5)
            return Blocked("Weight-loss coaching is unavailable at an underweight BMI.");
        var expenditure = previous?.Expenditure ?? startingExpenditure ?? p.Maintenance ?? Resting(p) * p.Activity;
        var block = RecentBlock(days, today);
        var samples = block.Count == 0 ? [] : weights.Where(w => w.Date >= block[0].Date && w.Date <= block[^1].Date).OrderBy(w => w.Date).ToList();
        var halfway = block.Count == 0 ? today : block[0].Date.AddDays(block.Count / 2);
        var adaptive = allowAdaptation && block.Count >= 14 && samples.Count >= 6 && samples.Count(w => w.Date < halfway) >= 3
            && samples.Count(w => w.Date >= halfway) >= 3 && samples[^1].Date >= today.AddDays(-3);
        var reason = p.Maintenance is not null
            ? "Starting from your supplied maintenance estimate. Log complete days and weigh regularly to calibrate it."
            : $"Estimated resting energy: {Math.Round(Resting(p))} kcal/day using Mifflin–St Jeor. Your approximate activity multiplier is {p.Activity}. This is a starting estimate, not a metabolic measurement. Log complete days and weigh regularly to calibrate it.";
        if(startingExpenditure!=null)reason="Carrying your learned maintenance estimate into this phase, scaled only for an explicit activity change. Your selected pace sets the new target.";
        if (adaptive)
        {
            var observed = block.Average(d => d.Calories) - 7700 * Slope(samples);
            // Reject implausible estimates instead of using clipping to conceal input problems.
            if (observed < 1000 || observed > 7000)
            {
                adaptive = false;
                reason = "Holding: the observed estimate is outside the supported range. Review portions and weight entries.";
            }
            else
            {
                expenditure += .25 * (observed - expenditure);
                reason = $"Based on {block.Count} complete days and {samples.Count} weigh-ins. The expenditure estimate moves 25% toward the observed intake/weight relationship. This is a provisional estimate, not a metabolic measurement.";
            }
        }
        else if (previous != null && !allowAdaptation)
            reason = "Holding your accepted maintenance estimate until the next weekly check-in. New logs remain available for that review.";
        else if (previous != null)
            reason = $"Holding: need 14 consecutive complete days and six weigh-ins (three in each half), including one in the last three days. Current window: {block.Count} days, {samples.Count} weigh-ins.";

        var change = effectiveGoal switch { "lose" => p.EnergyAdjustmentPercent is {} deficit ? -expenditure * deficit / 100 : -Math.Min(expenditure * .20, p.WeightKg * .005 * 7700 / 7), "gain" => p.EnergyAdjustmentPercent is {} surplus ? expenditure * surplus / 100 : Math.Min(expenditure * .10, p.WeightKg * .0015 * 7700 / 7), _ => 0 };
        var target = Math.Round((expenditure + change) / 25, MidpointRounding.AwayFromZero) * 25;
        if (previous != null && !(progress.Complete && !previous.PhaseComplete))
        {
            if (!adaptive) target = previous.Calories;
            else if (Math.Abs(target - previous.Calories) < 50) target = previous.Calories;
            else target = Math.Clamp(target, previous.Calories - 100, previous.Calories + 100);
        }
        // Safety boundaries take precedence over the ordinary weekly step limit.
        target = Math.Max(target, Math.Ceiling(Math.Max(1500, expenditure * .75) / 25) * 25);
        if (progress.Complete) reason += " Phase complete: review a maintenance target before accepting the transition.";
        if (p.EnergyAdjustmentPercent is {} percent && effectiveGoal != "maintain") reason += $" Selected {percent}% {(effectiveGoal == "lose" ? "deficit" : "surplus")}; weekly limits and the calorie floor may moderate this target.";
        var protein = p.ProteinGrams ?? Math.Round(p.WeightKg * (p.ResistanceTraining && effectiveGoal == "lose" ? 2 : 1.6));
        var fat = target * .3 / 9;
        var carbs = (target - protein * 4 - fat * 9) / 4;
        if (carbs < 0) return Blocked("Protein and fat exceed the calorie target. Review your protein override.");
        return new(true, adaptive, target, expenditure, protein, Math.Round(fat, 1), Math.Round(carbs, 1), reason) { EffectiveGoal=effectiveGoal, PhaseComplete=progress.Complete, GoalProgress=progress };
    }

    private static CoachResult Blocked(string reason) => new(false, false, null, null, null, null, null, reason);
    private static List<NutritionDay> RecentBlock(IReadOnlyList<NutritionDay> days, DateOnly today)
    {
        var byDate = days.ToDictionary(d => d.Date);
        var block = new List<NutritionDay>();
        // A gap near today must hold updates, not resurrect an older convenient complete block.
        for (var date = today.AddDays(-1); date >= today.AddDays(-28); date = date.AddDays(-1))
        {
            if (!byDate.TryGetValue(date, out var day) || day.Status is not ("complete" or "fasting")) break;
            block.Add(day);
        }
        block.Reverse(); return block;
    }
    public static double Slope(IReadOnlyList<WeightPoint> weights)
    {
        var slopes = new List<double>();
        for (var i = 0; i < weights.Count; i++)
            for (var j = i + 1; j < weights.Count; j++)
                if (weights[j].Date != weights[i].Date)
                    slopes.Add((weights[j].Kg - weights[i].Kg) / (weights[j].Date.DayNumber - weights[i].Date.DayNumber));
        slopes.Sort(); if (slopes.Count == 0) return 0;
        return slopes.Count % 2 == 1 ? slopes[slopes.Count / 2] : (slopes[slopes.Count / 2 - 1] + slopes[slopes.Count / 2]) / 2;
    }
    public static IReadOnlyList<WeightPoint> Trend(IReadOnlyList<WeightPoint> weights)
    {
        var result = new List<WeightPoint>();
        foreach (var point in weights.OrderBy(w => w.Date))
        {
            var last = result.LastOrDefault();
            var smoothed = last == null ? point.Kg : last.Kg + (1 - Math.Pow(.5, (point.Date.DayNumber - last.Date.DayNumber) / 7d)) * (point.Kg - last.Kg);
            result.Add(point with { Kg = smoothed });
        }
        return result;
    }
}
