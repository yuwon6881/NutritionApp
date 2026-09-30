using System.Text.Json;
using System.Text.Json.Nodes;
using Nutrition.Api.Services.AI.Tools;

namespace Nutrition.Api.Services.AI.Agent;

public sealed class AiActionProposer(AiToolContext toolContext) : IAiActionProposer
{
    private static readonly string[] AllowedTypes = ["openFoodLog", "openAddFoodDraft", "openWeightEntry", "openCoaching", "openExpenditure", "openBarcodeScanner"];
    private readonly AiToolContext _toolContext = toolContext;
    private readonly List<AiUiAction> _accepted = [];
    public IReadOnlyList<AiUiAction> Accepted => _accepted;

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["actions"] = new JsonObject
            {
                ["type"] = "array", ["maxItems"] = 1,
                ["description"] = "One user-requested action to review. Never saves data.",
                ["items"] = new JsonObject
                {
                    ["type"] = "object",
                    ["properties"] = new JsonObject
                    {
                        ["type"] = new JsonObject { ["type"] = "string",
                            ["enum"] = new JsonArray(AllowedTypes.Select(t => (JsonNode?)JsonValue.Create(t)).ToArray()) },
                        ["payload"] = new JsonObject { ["type"] = "object", ["description"] = "date (yyyy-MM-dd), time (HH:mm), optional foodId and query (verified food name) for food search. Other fields are ignored." }
                    },
                    ["required"] = new JsonArray("type", "payload")
                }
            }
        },
        ["required"] = new JsonArray("actions")
    };

    public Task<string> ProposeAsync(string argumentsJson, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        JsonDocument document;
        try { document = JsonDocument.Parse(argumentsJson); }
        catch (JsonException) { return Task.FromResult(Error("Invalid arguments JSON.")); }
        using var lifetime = document;
        if (document.RootElement.ValueKind != JsonValueKind.Object ||
            !document.RootElement.TryGetProperty("actions", out var actions) || actions.ValueKind != JsonValueKind.Array)
            return Task.FromResult(Error("actions must be an array."));
        if (actions.GetArrayLength() > 1 || _accepted.Count > 0)
            return Task.FromResult(Error("Only one action can be reviewed per turn."));
        var results = new JsonArray();
        foreach (var action in actions.EnumerateArray())
        {
            try
            {
                if (action.ValueKind != JsonValueKind.Object ||
                    !action.TryGetProperty("type", out var typeValue) || typeValue.ValueKind != JsonValueKind.String ||
                    !action.TryGetProperty("payload", out var payloadValue) || payloadValue.ValueKind != JsonValueKind.Object)
                    throw new AiToolArgumentException("Each action requires a string type and an object payload.");
                var type = AllowedTypes.FirstOrDefault(t => t.Equals(typeValue.GetString(), StringComparison.OrdinalIgnoreCase))
                    ?? throw new AiToolArgumentException("Unsupported action type.");
                var args = AiToolArgs.Parse(payloadValue.GetRawText());
                var payload = new Dictionary<string, object?>();
                var date = args.OptionalDate("date");
                if (date.HasValue) payload["date"] = date.Value.ToString("yyyy-MM-dd");
                var time = args.OptionalString("time", 5);
                if (time != null)
                {
                    if (!TimeOnly.TryParseExact(time, "HH:mm", out _)) throw new AiToolArgumentException("time must be HH:mm.");
                    payload["time"] = time;
                }
                if (type == "openAddFoodDraft")
                {
                    AddEvidence(args, payload, "foodId", AiEvidenceLedger.Food);
                    var query = args.OptionalString("query", 200);
                    if (query != null)
                    {
                        if (!_toolContext.Evidence.Contains("foodName", query))
                            throw new AiToolArgumentException("query must be a food name returned by a tool this turn.");
                        payload["query"] = query;
                    }
                }
                _accepted.Add(new AiUiAction(type, payload, Guid.NewGuid()));
                results.Add(new JsonObject { ["type"] = type, ["accepted"] = true });
            }
            catch (AiToolArgumentException ex)
            {
                results.Add(new JsonObject { ["accepted"] = false, ["reason"] = ex.Message });
            }
        }
        return Task.FromResult(new JsonObject { ["results"] = results }.ToJsonString());
    }

    private void AddEvidence(AiToolArgs args, Dictionary<string, object?> payload, string key, string kind, bool required = false)
    {
        var id = required ? args.RequiredString(key, 160) : args.OptionalString(key, 160);
        if (id == null) return;
        if (!_toolContext.Evidence.Contains(kind, id))
            throw new AiToolArgumentException($"{key} '{id}' was not returned by any tool this turn. Look it up first.");
        payload[key] = id;
    }

    private static string Error(string message) => new JsonObject { ["ok"] = false, ["error"] = message }.ToJsonString();
}
