using Fitness.Ai.Contracts;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed class NutritionPeerSummaryService(AppDb db, NutritionDailySummaryService daily, TrainingContextService context,
    CoachingService coaching)
{
    public async Task<NutritionPeerSummary> Get(string subject, DateOnly? from, DateOnly? to, int? days, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == db.CurrentUser, ct);
        Validation.Require(user.IdentitySubject == subject, "Shared summary identity does not match the current account.", 403);
        var today = RetentionService.Today(user.ProfileJson);
        var end = to ?? today;
        var start = from ?? end.AddDays(1 - (days ?? 14));
        Validation.Require(start <= end && end <= today && end.DayNumber - start.DayNumber < 28
            && (days == null || days is >= 1 and <= 28), "Choose up to 28 nutrition days through today.");
        var goal = await context.Get(subject, ct);
        var summaries = await daily.Get(start, end, today, ct);
        // CleanTrend measures noise over the 28 days before end, which reaches back past start.
        var (raw, trend) = await WeightHistory.Compute(db, end.AddDays(-28), end, weights => (Weights(weights, start, end), (DateOnly?)end.AddDays(-28)), ct);
        var preview = await coaching.Preview(ct);
        return new(subject, user.Revision, goal.TimeZone, start, end, DateTime.UtcNow, "kcal", new(goal.EffectiveGoal, goal.PhaseComplete, goal.TargetRatePercent, goal.ObservedLossRatePercent, goal.ObservedWindowDays),
            Aggregate(summaries, start, end), new(raw.Length, raw.FirstOrDefault()?.Date, raw.LastOrDefault()?.Date,
                raw.FirstOrDefault()?.Kg, raw.LastOrDefault()?.Kg, trend.FirstOrDefault()?.Kg, trend.LastOrDefault()?.Kg,
                "context_and_outlier_filtered", trend.FirstOrDefault()?.Date, trend.LastOrDefault()?.Date), summaries, preview.Result.Eligible, preview.Result.Explanation);
    }

    internal static (WeightPoint[] Raw, WeightPoint[] Trend) Weights(IReadOnlyList<WeightPoint> weights, DateOnly start, DateOnly end)
        => (weights.Where(w => w.Date >= start).ToArray(), WeightSignal.CleanTrend(weights, end).Where(w => w.Date >= start).ToArray());

    public static NutritionPeriodSummary Aggregate(IReadOnlyList<NutritionDailySummary> days, DateOnly from, DateOnly to)
    {
        var complete = days.Where(d => d.Status is "complete" or "fasting").ToArray();
        var calories = complete.Where(d => d.Calories.HasValue).ToArray();
        var protein = complete.Where(d => d.Protein.HasValue).ToArray();
        var targets = calories.Where(d => d.Targets?.Calories != null).ToArray();
        var maintenance = calories.Where(d => d.EstimatedMaintenance != null && d.HoldReason == null).ToArray();
        var proteinTargets = protein.Where(d => d.Targets?.Protein != null).ToArray();
        static double? Average(double[] values) => values.Length == 0 ? null : Math.Round(values.Average(), 1);
        return new(from, to, complete.Length, days.Count(d => !d.Calories.HasValue), protein.Length,
            Average(calories.Select(d => d.Calories!.Value).ToArray()), Average(protein.Select(d => d.Protein!.Value).ToArray()),
            targets.Length, Average(targets.Select(d => d.Targets!.Calories!.Value - d.Calories!.Value).ToArray()),
            maintenance.Length, Average(maintenance.Select(d => d.EstimatedMaintenance!.Value - d.Calories!.Value).ToArray()),
            proteinTargets.Length, Average(proteinTargets.Select(d => d.Targets!.Protein!.Value - d.Protein!.Value).ToArray()),
            new Dictionary<string, int> { ["calories"] = complete.Count(d => d.Calories == null),
                ["protein"] = complete.Count(d => d.Protein == null), ["fat"] = complete.Count(d => d.Fat == null),
                ["carbs"] = complete.Count(d => d.Carbs == null), ["fiber"] = complete.Count(d => d.Fiber == null) });
    }
}
