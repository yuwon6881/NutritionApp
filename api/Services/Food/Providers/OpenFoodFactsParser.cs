using Nutrition.Api.Domain;
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
        var name=FoodResults.Text(product,"product_name_en")??FoodResults.Text(product,"product_name");
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
            basis??(scanned is not null?"per100g":"unverified"),ProductMeasure(product));
    }

    /// <summary>
    /// Search-a-licious can expose serving values in fields named *_100g. Once the product API has
    /// returned the same code, its nutrient basis is authoritative for both the result row and the
    /// editor; keep the search name and ordering while replacing the numeric data and portions.
    /// </summary>
    public static FoodResult ApplyHydratedProduct(FoodResult searchResult,FoodResult hydrated)
        =>searchResult with
        {
            Name=FoodResults.HasOnlyLatinLetters(searchResult.Name)||!FoodResults.HasOnlyLatinLetters(hydrated.Name)
                ?searchResult.Name
                :hydrated.Name,
            Calories=hydrated.Calories,
            Protein=hydrated.Protein,
            Fat=hydrated.Fat,
            Carbs=hydrated.Carbs,
            Fiber=hydrated.Fiber,
            ServingGrams=hydrated.ServingGrams,
            Portions=hydrated.Portions,
            Code=hydrated.Code??searchResult.Code,
            ServingCalories=hydrated.ServingCalories,
            Basis=hydrated.Basis,
            Measure=hydrated.Measure
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
    /// Open Food Facts publishes liquids per 100 ml under the same `_100g` keys. The product's own
    /// unit fields decide the measure; when neither is present, an explicit gram or millilitre amount in
    /// the serving or quantity text does. Nothing else (a category, a name) is used to guess a liquid.
    /// </summary>
    public static string ProductMeasure(JsonElement product)
    {
        foreach(var key in new[]{"product_quantity_unit","serving_quantity_unit"})
            if(Measures.FromProviderUnit(FoodResults.Text(product,key)) is {} unit)return unit;
        foreach(var key in new[]{"serving_size","quantity"})
            if(FoodResults.Text(product,key) is {} text&&MetricAmount().Match(text) is {Success:true} match)
                return Measures.FromProviderUnit(match.Groups["unit"].Value)!;
        return Measures.Grams;
    }

    /// <summary>
    /// A declared serving becomes one portion in the product's measure. A serving stated in the other
    /// measure, or without a unit the label confirms, is left out: no density converts millilitres
    /// to grams. Free-text hits can arrive without serving metadata; the search path hydrates those
    /// fields in bulk.
    /// </summary>
    public static IReadOnlyList<FoodPortion> MapPortions(JsonElement product)
    {
        if(!product.TryGetProperty("serving_quantity",out var quantity)||!FoodResults.TryNumber(quantity,out var amount))return [];
        var measure=ProductMeasure(product);
        var label=FoodResults.Text(product,"serving_size");
        if(Measures.FromProviderUnit(FoodResults.Text(product,"serving_quantity_unit")) is {} unit)
        {
            if(unit!=measure)return [];
        }
        else
        {
            // Older records omit the normalized unit. Require an explicit amount in the product's
            // measure in their label rather than interpreting a scoop as grams or millilitres.
            var match=MetricAmount().Match(label??"");
            if(!match.Success||Measures.FromProviderUnit(match.Groups["unit"].Value)!=measure
                ||!double.TryParse(match.Groups["amount"].Value.Replace(',','.'),NumberStyles.Float,CultureInfo.InvariantCulture,out var declared)||declared!=amount)return [];
        }
        // A label that is only an amount ("30.4g", "200 ml") says nothing the figure does not, so the
        // portion is called a serving. A serving of exactly 100 merely repeats the per-100 basis and
        // would make 100 look like the product's declared serving.
        var metricOnly=label is null||MetricOnlyLabel().IsMatch(label);
        if(metricOnly&&Math.Abs(amount-100)<.001)return [];
        return FoodResults.LimitPortions([new FoodPortion(metricOnly?"serving":label!,amount)]);
    }

    [GeneratedRegex(@"^\s*\d+(?:[.,]\d+)?\s*(?:g|ml)?\s*$",RegexOptions.IgnoreCase)]
    private static partial Regex MetricOnlyLabel();

    private static double? Nutrient(JsonElement product,string key)=>
        product.TryGetProperty("nutriments",out var nutrients)&&nutrients.ValueKind==JsonValueKind.Object
        &&nutrients.TryGetProperty(key+"_100g",out var value)&&FoodResults.TryNumber(value,out var number)?number:null;

    [GeneratedRegex(@"(?<amount>\d+(?:[.,]\d+)?)\s*(?<unit>g|ml)\b",RegexOptions.IgnoreCase)]
    private static partial Regex MetricAmount();
}
