using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services.AI.Tools;

public sealed class GetWeightTrendTool : IAiTool
{
    private readonly AppDb _db;

    public GetWeightTrendTool(AppDb db)
    {
        _db = db;
    }

    public string Name => "get_weight_trend";
    public string Description => "Get scale weigh-ins and smoothed trend weights over a recent time period.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["days"] = new JsonObject
            {
                ["type"] = "integer",
                ["description"] = "Number of recent days of weight history (7-90, default 30)."
            }
        }
    };

    public string ProgressLabel(AiToolArgs args) => "Looking up your weight history...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var days = args.OptionalInt("days", 7, 90) ?? 30;
        var fromDate = context.Today.AddDays(-(days - 1));

        var weights = await _db.Weights.AsNoTracking()
            .Where(w => w.Date >= fromDate && w.Date <= context.Today && !w.Deleted)
            .OrderBy(w => w.Date)
            .ToListAsync(cancellationToken);

        var trends = await _db.ExpenditureEstimates.AsNoTracking()
            .Where(e => e.Date >= fromDate && e.Date <= context.Today)
            .ToDictionaryAsync(e => e.Date, cancellationToken);

        context.Evidence.RecordAll(AiEvidenceLedger.Weight, weights.Select(w => w.Id.ToString()));

        var points = weights.Select(w =>
        {
            trends.TryGetValue(w.Date, out var trendEst);
            return new
            {
                id = w.Id.ToString(),
                date = w.Date.ToString("yyyy-MM-dd"),
                scaleWeight = ConvertWeight(w.Kg, context.WeightUnit),
                trendWeight = trendEst?.TrendWeightKg.HasValue == true
                    ? ConvertWeight(trendEst.TrendWeightKg.Value, context.WeightUnit)
                    : (double?)null,
                context = w.Context
            };
        }).ToList();

        double? currentTrend = null;
        if (trends.TryGetValue(context.Today, out var todayTrend) && todayTrend.TrendWeightKg.HasValue)
        {
            currentTrend = ConvertWeight(todayTrend.TrendWeightKg.Value, context.WeightUnit);
        }
        else
        {
            var latestTrend = trends.Values
                .Where(t => t.TrendWeightKg.HasValue)
                .OrderByDescending(t => t.Date)
                .FirstOrDefault();
            if (latestTrend?.TrendWeightKg.HasValue == true)
                currentTrend = ConvertWeight(latestTrend.TrendWeightKg.Value, context.WeightUnit);
        }

        return AiToolResult.Of(new
        {
            weightUnit = context.WeightUnit,
            count = points.Count,
            currentTrendWeight = currentTrend,
            points
        });
    }

    private static double ConvertWeight(double weightKg, string unit)
    {
        if (unit.Equals("lb", StringComparison.OrdinalIgnoreCase))
            return Math.Round(weightKg * 2.20462, 1);
        return Math.Round(weightKg, 1);
    }
}
