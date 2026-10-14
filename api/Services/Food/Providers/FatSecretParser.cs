using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Maps fatsecret Platform JSON. Values arrive as strings, and a list holding one item arrives as
/// that item rather than a one-element array, so every list read goes through <see cref="Items"/>.
/// </summary>
public static partial class FatSecretParser
{
    public sealed record SearchHit(string Id,string Name,string? Brand,bool Generic,string? Description);

    public static IReadOnlyList<SearchHit> SearchHits(JsonElement root)
    {
        if(!root.TryGetProperty("foods",out var foods)||!foods.TryGetProperty("food",out var list))return [];
        return Items(list)
            .Select(food=>FoodResults.Text(food,"food_id") is { } id&&FoodResults.Text(food,"food_name") is { } name
                ?new SearchHit(id,name,FoodResults.Text(food,"brand_name"),FoodResults.Text(food,"food_type")=="Generic",FoodResults.Text(food,"food_description"))
                :null)
            .OfType<SearchHit>()
            .ToArray();
    }

    /// <summary>
    /// Builds a per-100 result from food.get servings. Nutrients come from a gram-measured serving
    /// (100 g when offered); a food with only millilitre servings is per 100 ml, and ounces-only servings
    /// are not portions here. Servings in the other measure are left out rather than converted.
    /// </summary>
    public static FoodResult? Detail(JsonElement root,SearchHit hit,string? code=null)
    {
        if(!root.TryGetProperty("food",out var food)||!food.TryGetProperty("servings",out var servings)||!servings.TryGetProperty("serving",out var list))return null;
        var all=Items(list).ToArray();
        var measure=all.Any(serving=>Amount(serving,Measures.Grams) is > 0)?Measures.Grams:Measures.Millilitres;
        var gram=all.Where(serving=>Amount(serving,measure) is > 0).ToArray();
        var basis=gram.FirstOrDefault(serving=>Amount(serving,measure)==100);
        if(basis.ValueKind==JsonValueKind.Undefined)basis=gram.FirstOrDefault();
        if(basis.ValueKind==JsonValueKind.Undefined||Amount(basis,measure) is not { } grams)return null;
        double? Per100(string name)=>FoodResults.Number(basis,name) is { } value?value*100/grams:null;
        if(Per100("calories") is not { } calories)return null;
        var portions=FoodResults.LimitPortions(gram
            .Select(serving=>FoodResults.Text(serving,"serving_description") is { } description&&FoodResults.PortionLabel(description) is { } label
                ?new FoodPortion(label,Amount(serving,measure)!.Value)
                :null)
            .OfType<FoodPortion>());
        return Result(hit,calories,Per100("protein"),Per100("fat"),Per100("carbohydrate"),Per100("fiber"),portions,code,measure);
    }

    /// <summary>
    /// The search summary ("Per 100g - Calories: 89kcal | Fat: 0.33g | ...") is only usable when it is
    /// already per 100 g or 100 ml; "Per 1 serving" has no weight, and guessing one would invent a basis.
    /// </summary>
    public static FoodResult? FromDescription(SearchHit hit)
    {
        if(hit.Description is not { } description)return null;
        var match=Summary().Match(description);
        if(!match.Success)return null;
        double? Value(string group)=>match.Groups[group].Success&&double.TryParse(match.Groups[group].Value,NumberStyles.Float,CultureInfo.InvariantCulture,out var value)?value:null;
        var measure=Measures.FromProviderUnit(match.Groups["unit"].Value)!;
        return Value("kcal") is { } calories?Result(hit,calories,Value("protein"),Value("fat"),Value("carbs"),null,[],null,measure):null;
    }

    public static IEnumerable<JsonElement> Items(JsonElement value)=>value.ValueKind switch
    {
        JsonValueKind.Array=>value.EnumerateArray(),
        JsonValueKind.Object=>[value],
        _=>[],
    };

    private static FoodResult Result(SearchHit hit,double calories,double? protein,double? fat,double? carbs,double? fiber,IReadOnlyList<FoodPortion> portions,string? code,string measure=Measures.Grams)
        =>new(FoodResults.Label(hit.Name,hit.Brand),calories,protein,fat,carbs,fiber,FatSecretProvider.Attribution,100,portions,code,
            FoodResults.ServingCalories(calories,portions),"per100g",measure,IsGeneric:hit.Generic);

    private static double? Amount(JsonElement serving,string measure)
        =>Measures.FromProviderUnit(FoodResults.Text(serving,"metric_serving_unit"))==measure?FoodResults.Number(serving,"metric_serving_amount"):null;

    [GeneratedRegex(@"^Per 100(?<unit>g|ml) - Calories: (?<kcal>[\d.]+)kcal(?: \| Fat: (?<fat>[\d.]+)g)?(?: \| Carbs: (?<carbs>[\d.]+)g)?(?: \| Protein: (?<protein>[\d.]+)g)?",RegexOptions.IgnoreCase)]
    private static partial Regex Summary();
}
