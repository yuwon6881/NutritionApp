using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services.AI.Tools;

// Past accepted targets, weekly check-in choices, and goal-phase decisions, plus the goal settings
// the coach works from. It only reports what the server already decided: a past plan is history,
// never a target the model may restate as current or propose.
public sealed class GetCoachingHistoryTool(AppDb db) : IAiTool
{
    public string Name => "get_coaching_history";
    public string Description =>
        "Past accepted calorie/macro plans, weekly check-in decisions, goal-phase decisions, and the current goal settings. History only; use get_coaching_recommendation for the current proposal.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["limit"] = new JsonObject
            {
                ["type"] = "integer",
                ["description"] = "Most recent records of each kind (1-20, default 8)."
            }
        }
    };

    public string ProgressLabel(AiToolArgs args) => "Looking up your coaching history...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var limit = args.OptionalInt("limit", 1, 20) ?? 8;

        // One extra row of each kind lets the result say honestly whether older history exists.
        var plans = await db.Plans.AsNoTracking().Where(p => !p.Deleted)
            .OrderByDescending(p => p.Date).ThenByDescending(p => p.Revision)
            .Take(limit + 1).ToListAsync(cancellationToken);
        var checkIns = await db.CheckIns.AsNoTracking().Where(c => !c.Deleted)
            .OrderByDescending(c => c.Date).ThenByDescending(c => c.Revision)
            .Take(limit + 1).ToListAsync(cancellationToken);
        var phases = await db.PhaseDecisions.AsNoTracking().Where(p => !p.Deleted)
            .OrderByDescending(p => p.Date).ThenByDescending(p => p.Revision)
            .Take(limit + 1).ToListAsync(cancellationToken);
        var profileJson = await db.Users.AsNoTracking()
            .Where(u => u.Id == db.CurrentUser)
            .Select(u => u.ProfileJson)
            .FirstOrDefaultAsync(cancellationToken);

        context.Evidence.Record(AiEvidenceLedger.Coaching, "history");
        var truncated = plans.Count > limit || checkIns.Count > limit || phases.Count > limit;

        return AiToolResult.Of(new
        {
            energyUnit = context.EnergyUnit,
            weightUnit = context.WeightUnit,
            goal = Goal(profileJson, context),
            acceptedPlans = plans.Take(limit).Select(p => Plan(p, context)).ToList(),
            checkInDecisions = checkIns.Take(limit).Select(c => new
            {
                date = c.Date.ToString("yyyy-MM-dd"),
                weekStart = c.WeekStart.ToString("yyyy-MM-dd"),
                decision = c.Decision == "declined" ? "kept current targets" : c.Decision
            }).ToList(),
            phaseDecisions = phases.Take(limit).Select(p => new
            {
                date = p.Date.ToString("yyyy-MM-dd"),
                decision = p.Decision switch
                {
                    "completed" => "goal phase completed; moved to maintenance",
                    "await-trend" => "goal weight reached on the scale; waiting for the trend to confirm",
                    _ => p.Decision
                },
                reachedBy = p.ReachedBy
            }).ToList(),
            moreHistoryAvailable = truncated,
            note = "Accepted plans are past targets, newest first. Expenditure values are estimates. Only the current proposal from get_coaching_recommendation can be accepted."
        }, truncated: truncated);
    }

    private static object Plan(AcceptedPlan plan, AiToolContext context)
    {
        var result = Read<CoachResult>(plan.ResultJson);
        return new
        {
            date = plan.Date.ToString("yyyy-MM-dd"),
            calories = AiNutritionValues.Energy(result?.Calories, context),
            protein = Round(result?.Protein),
            fat = Round(result?.Fat),
            carbs = Round(result?.Carbs),
            estimatedExpenditure = AiNutritionValues.Energy(result?.Expenditure, context),
            goal = result?.EffectiveGoal,
            goalRatePercent = result?.GoalRatePercent,
            adaptive = result?.Adaptive,
            phaseComplete = result?.PhaseComplete
        };
    }

    // Body and goal settings the coach calculates from. Clinical eligibility flags stay out: the
    // recommendation tool already reports whether coaching is available and why.
    private static object? Goal(string? profileJson, AiToolContext context)
    {
        var profile = Read<Profile>(profileJson);
        if (profile == null) return null;
        return new
        {
            goal = string.IsNullOrEmpty(profile.Goal) ? null : profile.Goal,
            trackingMode = profile.PhaseMode,
            phaseStart = profile.PhaseStart?.ToString("yyyy-MM-dd"),
            durationWeeks = profile.DurationWeeks,
            targetWeight = Weight(profile.TargetWeightKg, context),
            phaseStartWeight = Weight(profile.PhaseStartWeightKg, context),
            goalRatePercentPerWeek = profile.GoalRatePercent,
            activityLevel = profile.ActivityLevel is { } level ? ActivityLevels.Label(level) : null,
            sex = string.IsNullOrEmpty(profile.Sex) ? null : profile.Sex,
            age = profile.Age > 0 || profile.DateOfBirth != null ? Coach.AgeAt(profile, context.Today) : (int?)null,
            heightCm = profile.HeightCm > 0 ? Math.Round(profile.HeightCm) : (double?)null
        };
    }

    private static T? Read<T>(string? json) where T : class
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return Json.Read<T>(json); }
        catch (Exception ex) when (ex is JsonException or DomainException) { return null; }
    }

    private static double? Round(double? value) => value.HasValue ? Math.Round(value.Value) : null;

    private static double? Weight(double? kg, AiToolContext context) => kg is not { } value ? null
        : Math.Round(context.WeightUnit.Equals("lb", StringComparison.OrdinalIgnoreCase) ? value * 2.20462 : value, 1);
}
