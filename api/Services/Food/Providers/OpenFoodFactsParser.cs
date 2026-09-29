using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Maps Open Food Facts JSON. The two sources disagree: the search index sends brands as an array
/// and indexes no serving at all, while the product endpoint sends brands as one comma string and
/// serving_quantity as a string.
/// </summary>
public static partial class OpenFoodFactsParser
{
    public const string Attribution="Open Food Facts / ODbL";

    /// <summary>
    /// Maps one product. A scanned barcode supplies its own code and keeps the generic name a label
    /// scan can still correct; a search hit without a name or calories is dropped, because an
    /// unnamed or calorie-less row cannot be logged honestly.
    /// </summary>
    public static FoodResult? ReadProduct(JsonElement product,string? scanned,string? basis=null)
    {
        var name=FoodResults.Text(product,"product_name")??FoodResults.Text(product,"product_name_en");
        if(name is null&&scanned is null)return null;
        if(Calories(product) is not {} calories)return null;
        var code=scanned??Code(product);
        double? N(string key)=>Nutrient(product,key);
        var portions=MapPortions(product);
        return new FoodResult(
            FoodResults.Label(name??"Packaged food",Brand(product)),
            calories,N("proteins"),N("fat"),N("carbohydrates"),N("fiber"),
            code is null?Attribution:Attribution+" / "+code,
            100,portions,code,FoodResults.ServingCalories(calories,portions),
            basis??(scanned is not null?"per100g":"unverified"));
    }

    /// <summary>
    /// Search-a-licious can expose serving values in fields named *_100g. Once the product API has
    /// returned the same code, its nutrient basis is authoritative for both the result row and the
    /// editor; keep the search name and ordering while replacing the numeric data and portions.
    /// </summary>
    public static FoodResult ApplyHydratedProduct(FoodResult searchResult,FoodResult hydrated)
        =>searchResult with
        {
            Calories=hydrated.Calories,
            Protein=hydrated.Protein,
            Fat=hydrated.Fat,
            Carbs=hydrated.Carbs,
            Fiber=hydrated.Fiber,
            ServingGrams=hydrated.ServingGrams,
            Portions=hydrated.Portions,
            Code=hydrated.Code??searchResult.Code,
            ServingCalories=hydrated.ServingCalories,
            Basis=hydrated.Basis
        };

    /// <summary>
    /// The product endpoint sends brands as one comma-separated string and the search index sends
    /// an array. Both reduce to the leading brand, which is all a label is built from.
    /// </summary>
    public static string? Brand(JsonElement product)
    {
        if(!product.TryGetProperty("brands",out var brands))return null;
        if(brands.ValueKind==JsonValueKind.String)return brands.GetString();
        if(brands.ValueKind!=JsonValueKind.Array)return null;
        foreach(var brand in brands.EnumerateArray())
            if(brand.ValueKind==JsonValueKind.String&&brand.GetString()?.Trim() is {Length:>0} text)return text;
        return null;
    }

    public static double? Calories(JsonElement product)=>Nutrient(product,"energy-kcal");

    public static string? Code(JsonElement product)
    {
        if(!product.TryGetProperty("code",out var value))return null;
        if(value.ValueKind==JsonValueKind.String)return value.GetString()?.Trim() is {Length:>0} text?text:null;
        return value.ValueKind==JsonValueKind.Number?value.ToString():null;
    }

    /// <summary>
    /// A declared serving becomes one portion. Servings measured in millilitres are left out: this
    /// app weighs portions in grams, and only water-like liquids convert one to one. Free-text hits
    /// can arrive without serving metadata; the search path hydrates those fields in bulk.
    /// </summary>
    public static IReadOnlyList<FoodPortion> MapPortions(JsonElement product)
    {
        if(!product.TryGetProperty("serving_quantity",out var quantity)||!FoodResults.TryNumber(quantity,out var grams))return [];
        var unit=product.TryGetProperty("serving_quantity_unit",out var unitElement)&&unitElement.ValueKind==JsonValueKind.String
            ? unitElement.GetString()?.Trim()
            : null;
        if(!string.IsNullOrEmpty(unit)&&!string.Equals(unit,"g",StringComparison.OrdinalIgnoreCase))return [];
        var label=FoodResults.Text(product,"serving_size");
        if(string.IsNullOrEmpty(unit))
        {
            // Older records omit the normalized unit. Require an explicit gram weight
            // in their label rather than interpreting a scoop or liquid as grams.
            var match=GramLabel().Match(label??"");
            if(!match.Success||!double.TryParse(match.Groups["grams"].Value.Replace(',','.'),NumberStyles.Float,CultureInfo.InvariantCulture,out var declared)||declared!=grams)return [];
        }
        return FoodResults.LimitPortions([new FoodPortion(string.IsNullOrWhiteSpace(label)?"serving":label!,grams)]);
    }

    private static double? Nutrient(JsonElement product,string key)=>
        product.TryGetProperty("nutriments",out var nutrients)&&nutrients.ValueKind==JsonValueKind.Object
        &&nutrients.TryGetProperty(key+"_100g",out var value)&&FoodResults.TryNumber(value,out var number)?number:null;

    [GeneratedRegex(@"(?<grams>\d+(?:[.,]\d+)?)\s*g\b",RegexOptions.IgnoreCase)]
    private static partial Regex GramLabel();
}
