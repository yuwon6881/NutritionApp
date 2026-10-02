using System.Text.Json.Nodes;
using Nutrition.Api.Services;

namespace Nutrition.Api.Services.AI.Tools;

public sealed class GetWorkoutSummaryTool : IAiTool
{
    private readonly WorkoutSummaryService _workoutService;

    public GetWorkoutSummaryTool(WorkoutSummaryService workoutService)
    {
        _workoutService = workoutService;
    }

    public string Name => "get_workout_summary";
    public string Description => "Get recent workout sessions synced from WorkoutApp, including training days, volume, and muscle groups. upNext lists the active program's remaining planned days this week; they have not been trained.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["days"] = new JsonObject
            {
                ["type"] = "integer",
                ["description"] = "Number of recent days of workout history (1-30, default 7)."
            }
        }
    };

    public string ProgressLabel(AiToolArgs args) => "Looking up workout training summaries...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var days = args.OptionalInt("days", 1, 30) ?? 7;
        var fromDate = context.Today.AddDays(-(days - 1));

        IReadOnlyList<TrainingSummaryItem> workouts;
        try
        {
            workouts = await _workoutService.Get(fromDate, context.Today, null, cancellationToken);
        }
        catch (Nutrition.Api.Domain.DomainException)
        {
            return AiToolResult.Of(new
            {
                connected = false,
                message = "Workout summaries are unavailable. Check the connection in Settings.",
                workouts = Array.Empty<object>()
            });
        }

        // Planned program days are not training done; they are reported apart from the record.
        var upNext = workouts.Where(w => w.Status == WorkoutSummaryService.Upcoming).Select(w => w.WorkoutName).ToList();
        workouts = workouts.Where(w => w.Status != WorkoutSummaryService.Upcoming).ToList();

        if (workouts.Count == 0)
        {
            return AiToolResult.Of(new
            {
                count = 0,
                workouts = Array.Empty<object>(),
                upNext,
                message = "No workouts recorded in this time period."
            });
        }

        context.Evidence.RecordAll(AiEvidenceLedger.Workout, workouts.Select(w => w.Id));

        var list = workouts.Select(w => new
        {
            id = w.Id,
            date = w.LocalDate.ToString("yyyy-MM-dd"),
            workoutName = w.WorkoutName,
            status = w.Status,
            muscleGroups = w.MuscleGroups,
            workingSetCount = w.WorkingSetCount,
            volumeKg = w.ExternalVolumeKg.HasValue ? Math.Round(w.ExternalVolumeKg.Value, 1) : (double?)null,
            averageRpe = w.AverageRpe.HasValue ? Math.Round(w.AverageRpe.Value, 1) : (double?)null
        }).ToList();

        return AiToolResult.Of(new
        {
            count = list.Count,
            workouts = list,
            upNext
        });
    }
}
