using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services.AI.Tools;

// The summary and baseline share one read path; archived diary totals survive detail retention.
internal static class AiNutritionValues
{
    public static double? Energy(double? kcal, AiToolContext context) =>
        kcal.HasValue ? Math.Round(kcal.Value * (context.EnergyUnit == "kj" ? 4.184 : 1)) : null;

    public static double? Sum(IReadOnlyList<DiaryEntry> entries, Func<DiaryEntry, double?> nutrient) =>
        entries.Any(e => !nutrient(e).HasValue) ? null : Math.Round(entries.Sum(e => nutrient(e) ?? 0), 1);

    public static object? Targets(AcceptedPlan? plan, DateOnly date, AiToolContext context)
    {
        if (plan == null) return null;
        CoachResult result;
        try { result = Json.Read<CoachResult>(plan.ResultJson); }
        catch (JsonException) { return null; }
        var calories = result.DailyCalories is { Count: 7 } daily
            ? daily[((int)date.DayOfWeek + 6) % 7] : result.Calories;
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
        return new { calories = Energy(calories, context), protein, fat, carbs, planDate = plan.Date.ToString("yyyy-MM-dd") };
    }
}

public sealed class GetDailySummaryTool(AppDb db) : IAiTool
{
    public string Name => "get_daily_summary";
    public string Description => "Daily logged intake and accepted targets, including archived totals. Missing intake and nutrients stay unknown.";
    public System.Text.Json.Nodes.JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new System.Text.Json.Nodes.JsonObject
        {
            ["date"] = new System.Text.Json.Nodes.JsonObject { ["type"] = "string", ["description"] = "Specific yyyy-MM-dd date." },
            ["days"] = new System.Text.Json.Nodes.JsonObject { ["type"] = "integer", ["description"] = "Recent days (1-30, default 7)." }
        }
    };
    public string ProgressLabel(AiToolArgs args) => "Looking up your nutrition summaries";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var date = args.OptionalDate("date");
        var days = args.OptionalInt("days", 1, 30) ?? 7;
        var to = date ?? context.Today;
        var from = date ?? to.AddDays(1 - days);
        var entries = await db.Entries.AsNoTracking().Where(e => e.Date >= from && e.Date <= to && !e.Deleted)
            .ToListAsync(cancellationToken);
        var statuses = await db.Days.AsNoTracking().Where(d => d.Date >= from && d.Date <= to && !d.Deleted)
            .ToDictionaryAsync(d => d.Date, cancellationToken);
        // Only plans effective within the window, plus the latest plan already in force at its start.
        var previous = await db.Plans.AsNoTracking().Where(p => !p.Deleted && p.Date <= from)
            .OrderByDescending(p => p.Date).ThenByDescending(p => p.Revision).FirstOrDefaultAsync(cancellationToken);
        var plans = await db.Plans.AsNoTracking().Where(p => !p.Deleted && p.Date > from && p.Date <= to)
            .OrderByDescending(p => p.Date).ThenByDescending(p => p.Revision).ToListAsync(cancellationToken);
        if (previous != null) plans.Add(previous);
        var grouped = entries.GroupBy(e => e.Date).ToDictionary(g => g.Key, g => g.ToList());
        var summaries = new List<object>();
        for (var d = to; d >= from; d = d.AddDays(-1))
        {
            var items = grouped.GetValueOrDefault(d, []);
            var status = statuses.GetValueOrDefault(d);
            var archived = status?.Archived == true;
            var count = archived ? status!.EntryCount : items.Count;
            var resolved = LoggingDay.Status(d, context.Today, status?.Status, count > 0);
            var known = count > 0 || resolved == "fasting";
            double? Nutrient(Func<DiaryEntry, double?> select, double? saved) => known
                ? archived ? saved : AiNutritionValues.Sum(items, select) : null;
            summaries.Add(new
            {
                date = d.ToString("yyyy-MM-dd"), status = resolved, archived, entryCount = count,
                calories = known ? AiNutritionValues.Energy(archived ? status!.Calories : items.Sum(e => e.Calories), context) : null,
                protein = Nutrient(e => e.Protein, status?.Protein),
                fat = Nutrient(e => e.Fat, status?.Fat), carbs = Nutrient(e => e.Carbs, status?.Carbs),
                fiber = Nutrient(e => e.Fiber, status?.Fiber),
                targets = AiNutritionValues.Targets(plans.FirstOrDefault(p => p.Date <= d), d, context)
            });
        }
        return AiToolResult.Of(new { energyUnit = context.EnergyUnit, count = summaries.Count, days = summaries });
    }
}
