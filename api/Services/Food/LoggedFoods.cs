using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Foods this account has already logged, offered back in search. A public catalogue can omit a
/// product the person found by barcode or deep in an earlier list, so search adds the logged foods
/// whose name or brand carries every typed word, rebuilt from their latest weighed diary entry.
/// </summary>
public static class LoggedFoods
{
    /// <summary>At most this many logged foods are added to one list; the most-logged win.</summary>
    public const int MaxRows=5;

    /// <summary>How many of a food's newest diary entries are tried when rebuilding its per-100 values.</summary>
    private const int RecentEntriesTried=5;

    /// <summary>The account's logged foods matching every word of <paramref name="query"/>, most-logged first.</summary>
    public static async Task<IReadOnlyList<FoodResult>> Matching(string query,AppDb db,CancellationToken ct)
    {
        // Grouped in SQL; only the distinct names are matched here, never every diary row.
        var logged=await db.Entries.AsNoTracking()
            .Where(entry=>!entry.Deleted)
            .GroupBy(entry=>new {entry.Source,entry.Name})
            .Select(group=>new {group.Key.Source,group.Key.Name,Count=group.Count()})
            .ToListAsync(ct);
        var matches=logged
            .Where(food=>food.Name.Trim().Length>0&&FoodRanking.NamesEveryWord(food.Name,query))
            .OrderByDescending(food=>food.Count)
            .ThenBy(food=>food.Name,StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var results=new List<FoodResult>();
        foreach(var food in matches)
        {
            if(results.Count==MaxRows)break;
            // The newest entry may be a serving with no known weight; an earlier weighed one still
            // gives honest per-100 values, so the latest few are tried in turn.
            var recent=await db.Entries.AsNoTracking()
                .Where(entry=>!entry.Deleted&&entry.Source==food.Source&&entry.Name==food.Name)
                .OrderByDescending(entry=>entry.Date).ThenByDescending(entry=>entry.Time)
                .Take(RecentEntriesTried)
                .ToListAsync(ct);
            if(recent.Select(FromEntry).FirstOrDefault(result=>result is not null) is { } rebuilt)results.Add(rebuilt);
        }
        return results;
    }

    /// <summary>
    /// Adds the logged foods a provider list does not already hold. A provider row for the same
    /// product stays, because its data is current; when only its barcode matches, it takes the
    /// logged name and source so it is still recognised as logged (and logs under the same name).
    /// </summary>
    public static IReadOnlyList<FoodResult> AddMissing(IReadOnlyList<FoodResult> results,IReadOnlyList<FoodResult> logged)
    {
        if(logged.Count==0)return results;
        var merged=results.ToList();
        foreach(var food in logged)
        {
            var key=FoodRanking.UsageKey(food);
            if(merged.Any(result=>FoodRanking.UsageKey(result)==key))continue;
            var code=FoodResultMerger.NormalizeGtin(food.Code);
            var same=code is null?-1:merged.FindIndex(result=>FoodResultMerger.NormalizeGtin(result.Code)==code);
            if(same>=0)merged[same]=merged[same] with {Name=food.Name,Source=food.Source};
            else merged.Add(food);
        }
        return merged;
    }

    /// <summary>
    /// Per-100 values from one diary entry. An entry whose amount has no known weight or volume
    /// (a serving without its grams) cannot be rescaled honestly and is left out.
    /// </summary>
    public static FoodResult? FromEntry(DiaryEntry entry)
    {
        var amount=entry.Unit=="g"?entry.Quantity:entry.PortionGrams is { } grams?entry.Quantity*grams:(double?)null;
        if(amount is not > 0||!double.IsFinite(amount.Value)||!double.IsFinite(entry.Calories))return null;
        var factor=100/amount.Value;
        double? Per100(double? value)=>value is { } known?Math.Round(known*factor,2):null;
        IReadOnlyList<FoodPortion> portions=entry.PortionLabel is { } label&&entry.PortionGrams is { } portionGrams
            ?FoodResults.LimitPortions([new FoodPortion(label,portionGrams)])
            :[];
        var calories=Math.Round(entry.Calories*factor,2);
        return new FoodResult(entry.Name,calories,Per100(entry.Protein),Per100(entry.Fat),Per100(entry.Carbs),Per100(entry.Fiber),
            entry.Source,100,portions,Code(entry.Source),FoodResults.ServingCalories(calories,portions),"per100g",entry.Measure);
    }

    /// <summary>Provider rows carry their barcode as the last part of the source ("… / ODbL / 3428274200259").</summary>
    private static string? Code(string source)
    {
        var last=source.Split(" / ")[^1].Trim();
        return last.Length is >=8 and <=14&&last.All(char.IsAsciiDigit)?last:null;
    }
}
