using Nutrition.Api.Data;

namespace Nutrition.Api.Domain;

public sealed record Profile
{
    public int Age { get; init; }
    public DateOnly? DateOfBirth { get; init; }
    public double HeightCm { get; init; }
    public double WeightKg { get; init; }
    public string Sex { get; init; } = "";
    public double Activity { get; init; }
    public string Goal { get; init; } = "";
    public double? Maintenance { get; init; }
    public double? ProteinGrams { get; init; }
    public double? ProteinPercent { get; init; }
    public double? CarbsPercent { get; init; }
    public double? FatPercent { get; init; }
    public string? MacroPreset { get; init; }
    public string PhaseMode { get; init; } = "open";
    public DateOnly? PhaseStart { get; init; }
    public int? DurationWeeks { get; init; }
    public double? TargetWeightKg { get; init; }
    public double? PhaseStartWeightKg { get; init; }
    public double? GoalRatePercent { get; init; }
    public double? EnergyAdjustmentPercent { get; init; }
    public IReadOnlyList<double>? DistributionShares { get; init; }
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
    public double? WeeklyCalories { get; init; }
    public IReadOnlyList<int>? DailyCalories { get; init; }
    public double? GoalRatePercent { get; init; }
    public string EffectiveGoal { get; init; } = "maintain";
    public bool PhaseComplete { get; init; }
    public GoalProgress? GoalProgress { get; init; }
    public EnergyEvidence? Evidence { get; init; }
}

public static class Coach
{
    public const string Version = "2.0.0";
    public static double Resting(Profile p) => 10 * p.WeightKg + 6.25 * p.HeightCm - 5 * p.Age + (p.Sex == "male" ? 5 : -161);

    /// A stored date of birth is authoritative so age advances with the calendar; Age remains the fallback for profiles saved before it existed.
    public static int AgeAt(Profile p, DateOnly today)
    {
        if (p.DateOfBirth is not {} birth) return p.Age;
        var age = today.Year - birth.Year;
        if (birth.AddYears(age) > today) age--;
        return age;
    }

    public static CoachResult Calculate(Profile p, IReadOnlyList<NutritionDay> days,
        IReadOnlyList<WeightPoint> weights, PreviousPlan? previous, DateOnly today, double? startingExpenditure = null,
        bool allowAdaptation = true, PhaseDecision? phaseDecision = null)
    {
        p = p with { Age = AgeAt(p, today) };
        if (p.Age < 18 || p.PregnancyOrBreastfeeding || p.MedicalNutrition)
            return Blocked("Automated targets are unavailable for this profile. You can still keep a food and weight diary.");
        var progress = GoalPolicy.Evaluate(p, weights, today, phaseDecision);
        var currentWeight = Trend(weights.Where(w => w.Date <= today).ToArray()).LastOrDefault()?.Kg ?? p.WeightKg;
        p = p with { WeightKg = currentWeight };
        var effectiveGoal = progress.Complete ? "maintain" : p.Goal;
        if (effectiveGoal == "lose" && p.WeightKg / Math.Pow(p.HeightCm / 100, 2) < 18.5)
            return Blocked("Weight-loss coaching is unavailable at an underweight BMI.");
        var expenditure = previous?.Expenditure ?? startingExpenditure ?? p.Maintenance ?? Resting(p) * p.Activity;
        var estimate = Expenditure.Estimate(days, weights, expenditure, today, allowAdaptation);
        var adaptive = estimate.Adaptive;
        var reason = p.Maintenance is not null
            ? "Starting from your supplied maintenance estimate. Log complete days and weigh regularly to calibrate it."
            : $"Estimated resting energy: {Math.Round(Resting(p))} kcal/day using Mifflin–St Jeor. Your approximate activity multiplier is {p.Activity}. This is a starting estimate, not a metabolic measurement. Log complete days and weigh regularly to calibrate it.";
        if(startingExpenditure!=null)reason="Carrying your learned maintenance estimate into this phase, scaled only for an explicit activity change. Your selected pace sets the new target.";
        if (adaptive || previous != null || startingExpenditure != null) reason = estimate.Reason;
        if (adaptive) expenditure = estimate.Expenditure;

        var rate = EffectiveGoalRate(p, effectiveGoal);
        var change = p.GoalRatePercent is not null
            ? p.WeightKg * rate / 100 * 7700 / 7
            : effectiveGoal switch
            {
                "lose" => p.EnergyAdjustmentPercent is {} deficit
                    ? -expenditure * deficit / 100
                    : -Math.Min(expenditure * .20, p.WeightKg * .005 * 7700 / 7),
                "gain" => p.EnergyAdjustmentPercent is {} surplus
                    ? expenditure * surplus / 100
                    : Math.Min(expenditure * .10, p.WeightKg * .0015 * 7700 / 7),
                _ => 0
            };
        var target = Math.Round((expenditure + change) / 25, MidpointRounding.AwayFromZero) * 25;
        if (previous != null && !progress.Complete)
        {
            if (!adaptive) target = previous.Calories;
            else if (Math.Abs(target - previous.Calories) < 50) target = previous.Calories;
            else target = Math.Clamp(target, previous.Calories - 100, previous.Calories + 100);
        }
        // Safety boundaries take precedence over the ordinary weekly step limit.
        target = Math.Max(target, Math.Ceiling(Math.Max(1500, expenditure * .75) / 25) * 25);
        if (progress.Complete) reason += " Phase complete: review a maintenance target before accepting the transition.";
        if (p.GoalRatePercent is {} selectedRate && effectiveGoal != "maintain") reason += $" Selected {Math.Abs(selectedRate):0.##}% bodyweight per week; weekly limits and the calorie floor may moderate this target.";
        else if (p.EnergyAdjustmentPercent is {} percent && effectiveGoal != "maintain") reason += $" Selected {percent}% {(effectiveGoal == "lose" ? "deficit" : "surplus")}; weekly limits and the calorie floor may moderate this target.";
        double protein, fat, carbs;
        if (p.ProteinPercent is {} proteinShare && p.FatPercent is {} fatShare && p.CarbsPercent is {} carbShare)
        {
            protein = Math.Round(target * proteinShare / 100 / 4);
            fat = target * fatShare / 100 / 9;
            carbs = target * carbShare / 100 / 4;
        }
        else
        {
            protein = p.ProteinGrams ?? Math.Round(p.WeightKg * (p.ResistanceTraining && effectiveGoal == "lose" ? 2 : 1.6));
            fat = target * .3 / 9;
            carbs = (target - protein * 4 - fat * 9) / 4;
        }
        if (carbs < 0) return Blocked("Protein and fat exceed the calorie target. Review your protein override.");
        var weekly = target * 7;
        return new(true, adaptive, target, expenditure, protein, Math.Round(fat, 1), Math.Round(carbs, 1), reason)
        {
            EffectiveGoal=effectiveGoal,
            PhaseComplete=progress.Complete,
            GoalProgress=progress,
            Evidence=estimate.Evidence,
            WeeklyCalories=weekly,
            DailyCalories=p.GoalRatePercent is not null || p.DistributionShares is not null
                ? DailyTargets.Allocate(weekly, p.DistributionShares)
                : null,
            GoalRatePercent=rate
        };
    }

    public static double EffectiveGoalRate(Profile profile, string goal)
    {
        if (goal == "maintain") return 0;
        if (profile.GoalRatePercent is {} selected) return selected;
        return goal == "lose" ? -.5 : .15;
    }

    private static CoachResult Blocked(string reason) => new(false, false, null, null, null, null, null, reason);
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
