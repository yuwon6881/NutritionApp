using System.Text.Json.Nodes;
using Nutrition.Api.Services;

namespace Nutrition.Api.Services.AI.Tools;

public sealed class GetExpenditureTrendTool : IAiTool
{
    private readonly ExpenditureTrajectoryService _trajectoryService;

    public GetExpenditureTrendTool(ExpenditureTrajectoryService trajectoryService)
    {
        _trajectoryService = trajectoryService;
    }

    public string Name => "get_expenditure_trend";
    public string Description => "Get daily energy expenditure (TDEE) estimates, calorie targets, and goal trajectory.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["days"] = new JsonObject
            {
                ["type"] = "integer",
                ["description"] = "Number of recent days of expenditure history (7-90, default 30)."
            }
        }
    };

    public string ProgressLabel(AiToolArgs args) => "Estimating energy expenditure...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var days = args.OptionalInt("days", 7, 90) ?? 30;
        var estimates = await _trajectoryService.EnsureThroughToday(cancellationToken);

        var cutoff = context.Today.AddDays(-(days - 1));
        var filtered = estimates
            .Where(e => e.Date >= cutoff && e.Date <= context.Today)
            .OrderBy(e => e.Date)
            .ToList();

        var latest = filtered.LastOrDefault() ?? estimates.LastOrDefault();

        var points = filtered.Select(e => new
        {
            date = e.Date.ToString("yyyy-MM-dd"),
            expenditure = AiNutritionValues.Energy(e.Expenditure, context),
            suggestedCalories = AiNutritionValues.Energy(e.SuggestedCalories, context),
            confidence = Math.Round(e.Confidence, 2),
            effectiveGoal = e.EffectiveGoal,
            goalRatePercent = Math.Round(e.GoalRatePercent, 2)
        }).ToList();

        return AiToolResult.Of(new
        {
            energyUnit = context.EnergyUnit,
            count = points.Count,
            currentTdee = AiNutritionValues.Energy(latest?.Expenditure, context),
            currentSuggestedCalories = AiNutritionValues.Energy(latest?.SuggestedCalories, context),
            confidence = latest != null ? (double?)Math.Round(latest.Confidence, 2) : null,
            holdReason = latest?.HoldReason,
            history = points
        }, approximate: true);
    }
}
