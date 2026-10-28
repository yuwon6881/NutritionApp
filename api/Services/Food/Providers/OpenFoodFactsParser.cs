using Nutrition.Api.Domain;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Maps Open Food Facts product-endpoint JSON, which sends brands as one comma string and
/// serving_quantity as a string. tools/off-import mirrors these rules for the bundled export.
/// </summary>
public static partial class OpenFoodFactsParser
{
    public const string Attribution="Open Food Facts / ODbL";

    /// <summary>
    /// Maps one scanned product. It keeps the generic name a label scan can still correct, and a
    /// product without calories is dropped, because a calorie-less row cannot be logged honestly.
    /// </summary>
    public static FoodResult? ReadProduct(JsonElement product,string code)
    {
        if(Calories(product) is not {} calories)return null;
        var name=FoodResults.Text(product,"product_name_en")??FoodResults.Text(product,"product_name")??"Packaged food";
        double? N(string key)=>Nutrient(product,key);
        var portions=MapPortions(product);
        return new FoodResult(
            FoodResults.Label(name,FoodResults.Text(product,"brands")),
            calories,N("proteins"),N("fat"),N("carbohydrates"),N("fiber"),
            Attribution+" / "+code,100,portions,code,FoodResults.ServingCalories(calories,portions),
            "per100g",ProductMeasure(product));
    }

    public static double? Calories(JsonElement product)=>Nutrient(product,"energy-kcal");

    /// <summary>
    /// Open Food Facts publishes liquids per 100 ml under the same `_100g` keys. A serving label that
    /// states an amount equal to `serving_quantity` ("1 serving (200 ml)") decides the measure, because
    /// the unit fields are sometimes left at "g" for a drink and would contradict the label shown beside
    /// them. Otherwise the product's unit fields decide, then an explicit amount in the serving or
    /// quantity text. Nothing else (a category, a name) is used to guess a liquid.
    /// </summary>
    public static string ProductMeasure(JsonElement product)
    {
        if(LabelMeasure(product) is {} declared)return declared;
        foreach(var key in new[]{"product_quantity_unit","serving_quantity_unit"})
            if(Measures.FromProviderUnit(FoodResults.Text(product,key)) is {} unit)return unit;
        foreach(var key in new[]{"serving_size","quantity"})
            if(FoodResults.Text(product,key) is {} text&&MetricAmount().Match(text) is {Success:true} match)
                return Measures.FromProviderUnit(match.Groups["unit"].Value)!;
        return Measures.Grams;
    }

    /// <summary>The measure of the serving label's amount, when that amount is the declared serving quantity.</summary>
    private static string? LabelMeasure(JsonElement product)
    {
        if(!product.TryGetProperty("serving_quantity",out var quantity)||!FoodResults.TryNumber(quantity,out var amount))return null;
        var match=MetricAmount().Match(FoodResults.Text(product,"serving_size")??"");
        return match.Success
            &&double.TryParse(match.Groups["amount"].Value.Replace(',','.'),NumberStyles.Float,CultureInfo.InvariantCulture,out var declared)&&declared==amount
            ?Measures.FromProviderUnit(match.Groups["unit"].Value)
            :null;
    }

    /// <summary>
    /// A declared serving becomes one portion in the product's measure. A serving stated in the other
    /// measure, or without a unit the label confirms, is left out: no density converts millilitres
    /// to grams.
    /// </summary>
    public static IReadOnlyList<FoodPortion> MapPortions(JsonElement product)
    {
        if(!product.TryGetProperty("serving_quantity",out var quantity)||!FoodResults.TryNumber(quantity,out var amount))return [];
        var measure=ProductMeasure(product);
        var label=FoodResults.Text(product,"serving_size");
        // A label that states the amount has already set the measure; otherwise the unit field must agree
        // with the product, and a unit-less record needs an explicit amount in its label.
        if(LabelMeasure(product) is null)
        {
            if(Measures.FromProviderUnit(FoodResults.Text(product,"serving_quantity_unit")) is not {} unit||unit!=measure)return [];
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
