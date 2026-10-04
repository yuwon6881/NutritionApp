using System.Text.Json.Nodes;

namespace Nutrition.Api.Services.AI.Tools;

public sealed class GetWorkoutSummaryTool(WorkoutSummaryService workouts) : IAiTool
{
    public string Name => "get_workout_summary";
    public string Description => "Linked Workout sessions with coverage/freshness and adjacent completed-week comparisons. Planned and in-progress work is separate; RPE is recorded set effort, not session RPE.";
    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject { ["days"] = new JsonObject { ["type"] = "integer", ["description"] = "Completed-day lookback (1-30, default 14); today is included separately." } }
    };
    public string ProgressLabel(AiToolArgs args) => "Checking linked training evidence...";
    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken ct)
    {
        var days = args.OptionalInt("days", 1, 30) ?? 14;
        var result = await workouts.GetForAi(context.Today.AddDays(-days), context.Today, context.TimeZone, ct);
        var completed = result.Items.Where(w => w.Status == "completed").ToArray();
        var sample = completed.OrderByDescending(w => w.CompletionDate ?? w.LocalDate).Take(12).Select(w => new
        {
            w.Id, startDate = w.LocalDate, w.CompletionDate, w.WorkoutName, w.WorkingSetCount,
            w.ExternalVolumeKg, w.SystemVolumeKg, w.ExternalVolumeComplete, w.SystemVolumeComplete, w.RepWorkingSets, w.TimedWorkingSets, w.DurationSeconds,
            recordedSetRpe = w.AverageRpe, w.EffortRecordedSets
        }).ToArray();
        context.Evidence.RecordAll(AiEvidenceLedger.Workout, sample.Select(w => w.Id));
        return AiToolResult.Of(new
        {
            source = "WorkoutApp", result.ConnectionState, result.Availability, result.Freshness, result.Warning,
            result.From, result.To, result.TimeZone, result.CoveredFrom, result.CoveredTo, result.LastSuccessAt, result.CompleteCoverage,
            completedSessionCount = completed.Length, completedSessions = sample,
            inProgress = result.Items.Where(w => w.Status == "in_progress").Select(w => new { w.WorkoutName, w.LocalDate }).ToArray(),
            upNext = result.Items.Where(w => w.Status == WorkoutSummaryService.Upcoming).Select(w => w.WorkoutName).ToArray(),
            comparison = WorkoutAiComparisons.Compare(result, context.Today),
            note = "Empty results establish no workouts only with complete coverage. Legacy history has unknown completion dates. Planned days are undated, not training done. Cached completed figures are retained snapshots and may exclude later corrections."
        }, truncated: completed.Length > sample.Length, approximate: result.Freshness == "stale");
    }
}
