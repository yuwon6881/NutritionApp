using System.Text.Json.Nodes;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services.AI.Tools;

// Daily step totals from a connected Google Health account. Read-only and informational: steps
// never feed expenditure, coaching, or targets, so the model is told to report them as-is.
public sealed class GetStepsTool : IAiTool
{
    private readonly GoogleHealthService _googleHealth;
    private readonly AppDb _db;

    public GetStepsTool(GoogleHealthService googleHealth, AppDb db)
    {
        _googleHealth = googleHealth;
        _db = db;
    }

    public string Name => "get_steps";
    public string Description => "Get daily step counts from the user's connected Google Health account. Use it for questions about steps or walking this week, this month, or on a given day.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["days"] = new JsonObject
            {
                ["type"] = "integer",
                ["description"] = "Number of recent days including today (1-30, default 7)."
            }
        }
    };

    public string ProgressLabel(AiToolArgs args) => "Looking up your steps...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var days = args.OptionalInt("days", 1, 30) ?? 7;
        var from = context.Today.AddDays(-(days - 1));

        var userId = _db.CurrentUser;
        if (userId is null)
            return AiToolResult.Of(new { connected = false, message = "Steps are unavailable." });

        GoogleHealthSyncResult sync;
        try
        {
            sync = await _googleHealth.SyncAsync(userId.Value, cancellationToken);
        }
        catch (Nutrition.Api.Domain.DomainException)
        {
            return AiToolResult.Of(new { connected = false, message = "Steps are unavailable right now. Check the Google Health connection in Settings." });
        }

        if (sync.Status != "connected")
        {
            return AiToolResult.Of(new
            {
                connected = false,
                status = sync.Status,
                message = sync.Status == "reconnect_required"
                    ? "Google Health needs reconnecting in Settings before steps are available."
                    : "Google Health is not connected, so no step data is available. Steps appear after connecting it in Settings."
            });
        }

        var list = sync.Days
            .Where(day => day.Date >= from && day.Date <= context.Today)
            .OrderBy(day => day.Date)
            .Select(day => new { date = day.Date.ToString("yyyy-MM-dd"), steps = day.Count })
            .ToList();

        // Today is still in progress, so it is left out of the total and average of finished days.
        var finished = sync.Days
            .Where(day => day.Date >= from && day.Date < context.Today && day.Count.HasValue)
            .Select(day => day.Count!.Value)
            .ToList();
        var todaySteps = sync.Days.FirstOrDefault(day => day.Date == context.Today)?.Count;

        return AiToolResult.Of(new
        {
            connected = true,
            freshness = sync.Freshness,
            lastSyncedAt = sync.LastSyncedAt,
            warning = sync.WarningMessage,
            days = list,
            todaySteps,
            finishedDays = finished.Count,
            finishedDaysTotal = finished.Sum(),
            finishedDaysAverage = finished.Count == 0 ? (int?)null : (int)Math.Round(finished.Average()),
            note = "Today is in progress and excluded from the finished-day total and average. Days without a value have no recorded steps."
        });
    }
}
