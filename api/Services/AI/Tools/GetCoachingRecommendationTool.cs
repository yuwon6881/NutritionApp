using System.Text.Json.Nodes;
using Nutrition.Api.Services;

namespace Nutrition.Api.Services.AI.Tools;

public sealed class GetCoachingRecommendationTool : IAiTool
{
    private readonly CoachingService _coachingService;

    public GetCoachingRecommendationTool(CoachingService coachingService)
    {
        _coachingService = coachingService;
    }

    public string Name => "get_coaching_recommendation";
    public string Description => "Get current coaching status, check-in preview, and recommended calorie/macro adjustments.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject()
    };

    public string ProgressLabel(AiToolArgs args) => "Checking coaching recommendations...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        CoachingPreview preview;
        try
        {
            preview = await _coachingService.Preview(cancellationToken);
        }
        catch (Nutrition.Api.Domain.DomainException)
        {
            return AiToolResult.Of(new
            {
                available = false,
                message = "Complete your coaching profile before requesting a recommendation."
            });
        }

        context.Evidence.Record(AiEvidenceLedger.Coaching, "current");

        var result = preview.Result;
        var diff = preview.Changes;

        return AiToolResult.Of(new
        {
            available = true,
            eligible = result.Eligible,
            explanation = result.Explanation,
            evidence = result.Evidence,
            adaptive = result.Adaptive,
            energyUnit = context.EnergyUnit,
            effectiveGoal = result.EffectiveGoal,
            targetCalories = AiNutritionValues.Energy(result.Calories, context),
            targetProtein = result.Protein.HasValue ? Math.Round(result.Protein.Value) : (double?)null,
            targetFat = result.Fat.HasValue ? Math.Round(result.Fat.Value) : (double?)null,
            targetCarbs = result.Carbs.HasValue ? Math.Round(result.Carbs.Value) : (double?)null,
            canAccept = preview.CanAccept,
            holdReason = preview.HoldReason,
            nextCheckIn = preview.NextCheckIn.ToString("yyyy-MM-dd"),
            hasChanges = diff != null,
            changes = diff == null ? null : new
            {
                previousCalories = AiNutritionValues.Energy(diff.PreviousCalories, context),
                proposedCalories = AiNutritionValues.Energy(diff.ProposedCalories, context),
                previousProtein = diff.PreviousProtein.HasValue ? Math.Round(diff.PreviousProtein.Value) : (double?)null,
                proposedProtein = diff.ProposedProtein.HasValue ? Math.Round(diff.ProposedProtein.Value) : (double?)null,
                previousCarbs = diff.PreviousCarbs.HasValue ? Math.Round(diff.PreviousCarbs.Value) : (double?)null,
                proposedCarbs = diff.ProposedCarbs.HasValue ? Math.Round(diff.ProposedCarbs.Value) : (double?)null,
                previousFat = diff.PreviousFat.HasValue ? Math.Round(diff.PreviousFat.Value) : (double?)null,
                proposedFat = diff.ProposedFat.HasValue ? Math.Round(diff.ProposedFat.Value) : (double?)null
            }
        });
    }
}
