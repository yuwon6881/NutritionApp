using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services.AI.Tools;

public sealed class GetFoodLogTool : IAiTool
{
    private readonly AppDb _db;

    public GetFoodLogTool(AppDb db)
    {
        _db = db;
    }

    public string Name => "get_food_log";
    public string Description => "Get itemized meals and food diary entries logged for a specific date.";

    public JsonObject ParametersSchema => new()
    {
        ["type"] = "object",
        ["properties"] = new JsonObject
        {
            ["date"] = new JsonObject
            {
                ["type"] = "string",
                ["description"] = "Date in yyyy-MM-dd format. Defaults to today if omitted."
            }
        }
    };

    public string ProgressLabel(AiToolArgs args) => "Looking up your food log...";

    public async Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken cancellationToken)
    {
        var date = args.OptionalDate("date") ?? context.Today;

        var entries = await _db.Entries.AsNoTracking()
            .Where(e => e.Date == date && !e.Deleted)
            .OrderBy(e => e.Time ?? "99:99")
            .ThenBy(e => e.Name)
            .ToListAsync(cancellationToken);

        var archived = await _db.Days.AsNoTracking()
            .Where(d => d.Date == date && d.Archived && !d.Deleted).FirstOrDefaultAsync(cancellationToken);
        if (archived != null)
            return AiToolResult.Of(new { date = date.ToString("yyyy-MM-dd"), archived = true,
                itemCount = archived.EntryCount, energyUnit = context.EnergyUnit,
                totals = new { calories = AiNutritionValues.Energy(archived.Calories, context),
                    protein = archived.Protein, fat = archived.Fat, carbs = archived.Carbs, fiber = archived.Fiber },
                items = Array.Empty<object>(), message = "Meal details were archived. Only daily totals remain available." });

        if (entries.Count == 0)
        {
            return AiToolResult.Of(new
            {
                date = date.ToString("yyyy-MM-dd"),
                itemCount = 0,
                items = Array.Empty<object>(),
                message = $"No food entries logged for {date:yyyy-MM-dd}."
            });
        }

        context.Evidence.RecordAll(AiEvidenceLedger.FoodLog, entries.Select(e => e.Id.ToString()));

        var items = entries.Select(e => new
        {
            id = e.Id.ToString(),
            name = e.Name,
            time = e.Time,
            quantity = e.Quantity,
            unit = e.Unit,
            portionLabel = e.PortionLabel,
            portionGrams = e.PortionGrams,
            calories = AiNutritionValues.Energy(e.Calories, context),
            protein = e.Protein.HasValue ? Math.Round(e.Protein.Value, 1) : (double?)null,
            fat = e.Fat.HasValue ? Math.Round(e.Fat.Value, 1) : (double?)null,
            carbs = e.Carbs.HasValue ? Math.Round(e.Carbs.Value, 1) : (double?)null,
            fiber = e.Fiber.HasValue ? Math.Round(e.Fiber.Value, 1) : (double?)null,
            source = e.Source
        }).ToList();

        var totalCalories = entries.Sum(e => e.Calories);
        var totalProtein = AiNutritionValues.Sum(entries, e => e.Protein);
        var totalFat = AiNutritionValues.Sum(entries, e => e.Fat);
        var totalCarbs = AiNutritionValues.Sum(entries, e => e.Carbs);
        var totalFiber = AiNutritionValues.Sum(entries, e => e.Fiber);

        return AiToolResult.Of(new
        {
            date = date.ToString("yyyy-MM-dd"),
            itemCount = items.Count,
            energyUnit = context.EnergyUnit,
            archived = false,
            totals = new
            {
                calories = AiNutritionValues.Energy(totalCalories, context),
                protein = totalProtein,
                fat = totalFat,
                carbs = totalCarbs,
                fiber = totalFiber
            },
            items
        });
    }
}
