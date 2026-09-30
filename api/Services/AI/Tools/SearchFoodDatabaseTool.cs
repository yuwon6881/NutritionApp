using System.Text.Json.Nodes;
using Nutrition.Api.Data;
using Nutrition.Api.Services.FoodLookup;

namespace Nutrition.Api.Services.AI.Tools;

public sealed class SearchFoodDatabaseTool : IAiTool
{
    private readonly FoodCatalog _catalog;
    private readonly AppDb _db;

    public SearchFoodDatabaseTool(FoodCatalog catalog, AppDb db)
    {
        _catalog = catalog;
        _db = db;
    }

    public string Name => "search_food_database";
    public string Description => "Search the verified food database for nutritional facts, serving sizes, and calories.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["query"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "Search query for food name, brand, or ingredients (e.g. 'chicken breast', 'rolled oats')."
            },
            ["limit"] = new JsonObject
            {
                ["type"] = "integer",
                ["description"] = "Maximum results to return (1-15, default 5)."
            }
        },
        ["required"] = new JsonArray("query")
    };

    public string ProgressLabel(AiToolArgs args)
    {
        var q = args.OptionalString("query");
        return string.IsNullOrWhiteSpace(q) ? "Searching food database..." : $"Searching for '{q}'...";
    }

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var query = args.RequiredString("query", 100);
        var limit = args.OptionalInt("limit", 1, 15) ?? 5;

        var results = await _catalog.Search(query, _db, cancellationToken);
        var matches = results.Take(limit).ToList();

        if (matches.Count == 0)
        {
            return AiToolResult.Of(new
            {
                query,
                count = 0,
                foods = Array.Empty<object>(),
                message = $"No food matches found for '{query}'."
            });
        }

        foreach (var food in matches)
        {
            context.Evidence.Record(AiEvidenceLedger.Food, food.Code ?? food.Name);
            context.Evidence.Record("foodName", food.Name);
        }

        var list = matches.Select(f => new
        {
            name = f.Name,
            code = f.Code,
            source = f.Source,
            basis = f.Basis,
            servingGrams = f.ServingGrams,
            caloriesPer100g = f.Basis == "per100g" ? AiNutritionValues.Energy(f.Calories, context) : null,
            servingCalories = AiNutritionValues.Energy(f.ServingCalories, context),
            proteinPer100g = f.Protein.HasValue ? (double?)Math.Round(f.Protein.Value, 1) : null,
            fatPer100g = f.Fat.HasValue ? (double?)Math.Round(f.Fat.Value, 1) : null,
            carbsPer100g = f.Carbs.HasValue ? (double?)Math.Round(f.Carbs.Value, 1) : null,
            fiberPer100g = f.Fiber.HasValue ? (double?)Math.Round(f.Fiber.Value, 1) : null,
            portions = f.Portions?.Select(p => new { label = p.Label, grams = p.Grams }).ToList()
        }).ToList();

        return AiToolResult.Of(new
        {
            query,
            energyUnit = context.EnergyUnit,
            count = list.Count,
            foods = list
        });
    }
}
