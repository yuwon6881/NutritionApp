using Fitness.Ai.Contracts;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

// Shared by the local assistant and the peer feed. Stored plans remain effective-dated.
public sealed class NutritionDailySummaryService(AppDb db)
{
    public async Task<IReadOnlyList<NutritionDailySummary>> Get(DateOnly from, DateOnly to, DateOnly today, CancellationToken ct)
    {
        Validation.Require(from <= to && to.DayNumber - from.DayNumber < 30, "Choose at most 30 nutrition days.");
        var entries = await db.Entries.AsNoTracking().Where(e => e.Date >= from && e.Date <= to && !e.Deleted).ToListAsync(ct);
        var statuses = await db.Days.AsNoTracking().Where(d => d.Date >= from && d.Date <= to && !d.Deleted).ToDictionaryAsync(d => d.Date, ct);
        var previous = await db.Plans.AsNoTracking().Where(p => !p.Deleted && p.Date <= from)
            .OrderByDescending(p => p.Date).ThenByDescending(p => p.Revision).FirstOrDefaultAsync(ct);
        var plans = await db.Plans.AsNoTracking().Where(p => !p.Deleted && p.Date > from && p.Date <= to)
            .OrderByDescending(p => p.Date).ThenByDescending(p => p.Revision).ToListAsync(ct);
        if (previous != null) plans.Add(previous);
        var estimates = await db.ExpenditureEstimates.AsNoTracking().Where(e => e.Date >= from && e.Date <= to).ToDictionaryAsync(e => e.Date, ct);
        var grouped = entries.GroupBy(e => e.Date).ToDictionary(g => g.Key, g => g.ToList());
        var summaries = new List<NutritionDailySummary>();
        for (var date = to; date >= from; date = date.AddDays(-1))
        {
            var items = grouped.GetValueOrDefault(date, []);
            var status = statuses.GetValueOrDefault(date);
            var archived = status?.Archived == true;
            var count = archived ? status!.EntryCount : items.Count;
            var resolved = LoggingDay.Status(date, today, status?.Status, count > 0);
            var known = count > 0 || resolved == "fasting";
            double? Nutrient(Func<DiaryEntry, double?> select, double? saved) => !known ? null
                : archived ? saved : items.Any(e => !select(e).HasValue) ? null : items.Sum(e => select(e) ?? 0);
            var plan = plans.FirstOrDefault(p => p.Date <= date);
            var result = ReadPlan(plan);
            estimates.TryGetValue(date, out var estimate);
            summaries.Add(new(date, resolved, archived, count,
                known ? archived ? status!.Calories : items.Sum(e => e.Calories) : null,
                Nutrient(e => e.Protein, status?.Protein), Nutrient(e => e.Fat, status?.Fat),
                Nutrient(e => e.Carbs, status?.Carbs), Nutrient(e => e.Fiber, status?.Fiber), Targets(plan, date),
                estimate?.Expenditure ?? result?.Expenditure, estimate?.Confidence, estimate?.HoldReason,
                estimate != null ? "expenditure_snapshot" : result?.Expenditure != null ? "accepted_plan_estimate" : null));
        }
        return summaries;
    }

    public static NutritionTargets? Targets(AcceptedPlan? plan, DateOnly date)
    {
        var result = ReadPlan(plan);
        if (plan == null || result == null) return null;
        var calories = result.DailyCalories is { Count: 7 } daily ? daily[((int)date.DayOfWeek + 6) % 7] : result.Calories;
        if (calories == null || result.Calories is not > 0) return null;
        var scale = calories.Value / result.Calories.Value;
        double? protein = result.Protein.HasValue ? Math.Round(result.Protein.Value * scale, 1) : null;
        double? fat = result.Fat.HasValue ? Math.Round(result.Fat.Value * scale, 1) : null;
        double? carbs = result.Carbs.HasValue ? Math.Round(result.Carbs.Value * scale, 1) : null;
        if (result.ProteinFixed && result.Protein.HasValue && result.Fat.HasValue && result.Carbs.HasValue)
        {
            protein = result.Protein;
            var remaining = Math.Max(calories.Value - protein.Value * 4, 0);
            var reference = Math.Max(result.Calories.Value - protein.Value * 4, 0);
            var ratio = reference > 0 ? remaining / reference : 0;
            fat = Math.Round(result.Fat.Value * ratio, 1);
            carbs = Math.Round(result.Carbs.Value * ratio, 1);
        }
        return new(calories, protein, fat, carbs, plan.Date);
    }

    private static CoachResult? ReadPlan(AcceptedPlan? plan)
    {
        if (plan == null) return null;
        try { return Json.Read<CoachResult>(plan.ResultJson); }
        catch (JsonException) { return null; }
    }
}
