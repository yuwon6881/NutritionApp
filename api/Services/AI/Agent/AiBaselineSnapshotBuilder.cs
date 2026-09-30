using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Services.AI.Tools;

namespace Nutrition.Api.Services.AI.Agent;

// Baseline facts use the same read tools as later lookups so their semantics cannot drift.
public sealed class AiBaselineSnapshotBuilder(AppDb db)
{
    public async Task<JsonObject> BuildAsync(AiToolContext context, CancellationToken cancellationToken)
    {
        var snapshot = new JsonObject
        {
            ["today"] = context.Today.ToString("yyyy-MM-dd"),
            ["weightUnit"] = context.WeightUnit
        };
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == db.CurrentUser, cancellationToken);
        if (user != null) snapshot["displayName"] = user.DisplayName;
        snapshot["energyUnit"] = context.EnergyUnit;
        var summary = await new GetDailySummaryTool(db).ExecuteAsync(
            AiToolArgs.Parse(JsonSerializer.Serialize(new { date = context.Today.ToString("yyyy-MM-dd") })), context, cancellationToken);
        var summaryNode = JsonSerializer.SerializeToNode(summary.Data);
        snapshot["todaySummary"] = summaryNode?["days"]?[0]?.DeepClone();
        return snapshot;
    }
}
