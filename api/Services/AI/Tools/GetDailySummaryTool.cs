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
        var rows = await new NutritionDailySummaryService(db).Get(from, to, context.Today, cancellationToken);
        var summaries = rows.Select(d => new
        {
            date = d.Date.ToString("yyyy-MM-dd"), status = d.Status, archived = d.Archived, entryCount = d.EntryCount,
            calories = AiNutritionValues.Energy(d.Calories, context), protein = d.Protein, fat = d.Fat, carbs = d.Carbs, fiber = d.Fiber,
            targets = d.Targets == null ? null : new { calories = AiNutritionValues.Energy(d.Targets.Calories, context),
                protein = d.Targets.Protein, fat = d.Targets.Fat, carbs = d.Targets.Carbs, planDate = d.Targets.PlanDate.ToString("yyyy-MM-dd") }
        }).ToList();
        return AiToolResult.Of(new { energyUnit = context.EnergyUnit, count = summaries.Count, days = summaries });
    }
}
