using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services.AI.Tools;

public sealed class GetBodyFatHistoryTool : IAiTool
{
    private readonly AppDb _db;

    public GetBodyFatHistoryTool(AppDb db)
    {
        _db = db;
    }

    public string Name => "get_body_fat_history";
    public string Description => "Get historical body fat percentage and circumference measurements (waist, neck, hips, etc.).";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["limit"] = new JsonObject
            {
                ["type"] = "integer",
                ["description"] = "Number of recent records to return (1-20, default 10)."
            }
        }
    };

    public string ProgressLabel(AiToolArgs args) => "Looking up your body composition history...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var limit = args.OptionalInt("limit", 1, 20) ?? 10;

        var records = await _db.BodyRecords.AsNoTracking()
            .Where(b => !b.Deleted)
            .OrderByDescending(b => b.Date)
            .Take(limit)
            .ToListAsync(cancellationToken);

        if (records.Count == 0)
        {
            return AiToolResult.Of(new
            {
                count = 0,
                records = Array.Empty<object>(),
                message = "No body composition records found."
            });
        }

        context.Evidence.RecordAll(AiEvidenceLedger.BodyFat, records.Select(r => r.Id.ToString()));

        var entries = records.Select(r => new
        {
            id = r.Id.ToString(),
            date = r.Date.ToString("yyyy-MM-dd"),
            bodyFatPercent = r.Measurements.BodyFatPercent.HasValue ? Math.Round(r.Measurements.BodyFatPercent.Value, 1) : (double?)null,
            waistCm = r.Measurements.WaistCm.HasValue ? Math.Round(r.Measurements.WaistCm.Value, 1) : (double?)null,
            neckCm = r.Measurements.NeckCm.HasValue ? Math.Round(r.Measurements.NeckCm.Value, 1) : (double?)null,
            hipsCm = r.Measurements.HipsCm.HasValue ? Math.Round(r.Measurements.HipsCm.Value, 1) : (double?)null,
            chestCm = r.Measurements.ChestCm.HasValue ? Math.Round(r.Measurements.ChestCm.Value, 1) : (double?)null,
            shouldersCm = r.Measurements.ShouldersCm.HasValue ? Math.Round(r.Measurements.ShouldersCm.Value, 1) : (double?)null,
            leftBicepsCm = r.Measurements.LeftBicepsCm.HasValue ? Math.Round(r.Measurements.LeftBicepsCm.Value, 1) : (double?)null,
            rightBicepsCm = r.Measurements.RightBicepsCm.HasValue ? Math.Round(r.Measurements.RightBicepsCm.Value, 1) : (double?)null,
            leftThighCm = r.Measurements.LeftThighCm.HasValue ? Math.Round(r.Measurements.LeftThighCm.Value, 1) : (double?)null,
            rightThighCm = r.Measurements.RightThighCm.HasValue ? Math.Round(r.Measurements.RightThighCm.Value, 1) : (double?)null,
            leftCalfCm = r.Measurements.LeftCalfCm.HasValue ? Math.Round(r.Measurements.LeftCalfCm.Value, 1) : (double?)null,
            rightCalfCm = r.Measurements.RightCalfCm.HasValue ? Math.Round(r.Measurements.RightCalfCm.Value, 1) : (double?)null
        }).ToList();

        return AiToolResult.Of(new
        {
            count = entries.Count,
            records = entries
        });
    }
}
