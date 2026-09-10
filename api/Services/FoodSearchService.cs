using System.Text.Json;
using System.Globalization;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;
public record FoodPortion(string Label,double Grams);
public record FoodResult(string Name,double Calories,double? Protein,double? Fat,double? Carbs,double? Fiber,string Source,double ServingGrams=100,IReadOnlyList<FoodPortion>? Portions=null);
public sealed class FoodSearchService(HttpClient http,IConfiguration config,IMemoryCache cache)
{
    private static readonly SemaphoreSlim RateGate=new(1);
    private static DateTime nextBarcode=DateTime.MinValue;
    private static DateTime nextSearch=DateTime.MinValue;
    public async Task<IReadOnlyList<FoodResult>> Search(string query,CancellationToken ct)
    {
        query=query.Trim(); Validation.Require(query.Length is >=2 and <=100,"Enter 2–100 characters.");
        var key="usda:"+query.ToLowerInvariant();
        if(cache.TryGetValue<IReadOnlyList<FoodResult>>(key,out var saved)) return saved!;
        Validation.Require(!string.IsNullOrWhiteSpace(config["Usda:ApiKey"]),"Ingredient search is not configured. Use custom food, recent foods, or AI describe.",503);
        await RateGate.WaitAsync(ct);
        try { Validation.Require(DateTime.UtcNow>=nextSearch,"Please wait a moment before searching again.",429); nextSearch=DateTime.UtcNow.AddSeconds(4); }
        finally { RateGate.Release(); }
        using var response=await http.GetAsync("https://api.nal.usda.gov/fdc/v1/foods/search?api_key="+Uri.EscapeDataString(config["Usda:ApiKey"]!)+"&pageSize=12&query="+Uri.EscapeDataString(query),ct);
        Validation.Require(response.IsSuccessStatusCode,"Food search is temporarily unavailable. Your diary is still available.",503);
        using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var results=new List<FoodResult>();
        foreach(var food in json.RootElement.GetProperty("foods").EnumerateArray())
        {
            double? Nutrient(int id) => food.GetProperty("foodNutrients").EnumerateArray().Where(n=>n.GetProperty("nutrientId").GetInt32()==id).Select(n=>n.TryGetProperty("value",out var v)&&v.TryGetDouble(out var d)?(double?)d:null).FirstOrDefault();
            if(Nutrient(1008) is not {} calories) continue;
            results.Add(new(food.GetProperty("description").GetString()!,calories,Nutrient(1003),Nutrient(1004),Nutrient(1005),Nutrient(1079),"USDA FDC "+food.GetProperty("fdcId").GetInt32(),100,MapUsdaPortions(food)));
        }
        cache.Set(key,(IReadOnlyList<FoodResult>)results,new MemoryCacheEntryOptions { Size=1,AbsoluteExpirationRelativeToNow=TimeSpan.FromHours(6) }); return results;
    }
    public async Task<FoodResult> Barcode(string code,CancellationToken ct)
    {
        Validation.Require(code.Length is >=8 and <=14 && code.All(char.IsAsciiDigit),"Enter an 8–14 digit barcode.");
        if(cache.TryGetValue<FoodResult>("barcode:"+code,out var saved)) return saved!;
        await RateGate.WaitAsync(ct);
        try { Validation.Require(DateTime.UtcNow>=nextBarcode,"Wait four seconds before another barcode lookup.",429); nextBarcode=DateTime.UtcNow.AddSeconds(4.1); }
        finally { RateGate.Release(); }
        using var request=new HttpRequestMessage(HttpMethod.Get,$"https://world.openfoodfacts.org/api/v2/product/{code}?fields=product_name,nutriments,serving_size,serving_quantity,serving_quantity_unit");
        request.Headers.UserAgent.ParseAdd("NutritionCoach/1.0 (two-user personal nutrition tracker)");
        using var response=await http.SendAsync(request,ct);
        Validation.Require(response.IsSuccessStatusCode,"Barcode lookup unavailable. Scan the label or enter this food manually.",503);
        using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        Validation.Require(json.RootElement.TryGetProperty("product",out var product),"Barcode not found. Scan the label or add a custom food.",404);
        var nutrients=product.GetProperty("nutriments");
        double? N(string name)=>nutrients.TryGetProperty(name+"_100g",out var value)&&value.TryGetDouble(out var n)?n:null;
        Validation.Require(N("energy-kcal")!=null,"This product has no calorie data. Scan its label.",422);
        var result=new FoodResult(product.GetProperty("product_name").GetString()??"Packaged food",N("energy-kcal")!.Value,N("proteins"),N("fat"),N("carbohydrates"),N("fiber"),"Open Food Facts / ODbL / "+code,100,MapOffPortions(product));
        cache.Set("barcode:"+code,result,new MemoryCacheEntryOptions { Size=1,AbsoluteExpirationRelativeToNow=TimeSpan.FromDays(1) }); return result;
    }

    public static IReadOnlyList<FoodPortion> MapUsdaPortions(JsonElement food)
    {
        var candidates = new List<FoodPortion>();
        if (food.TryGetProperty("foodMeasures", out var measures) && measures.ValueKind == JsonValueKind.Array)
        {
            foreach (var measure in measures.EnumerateArray())
            {
                if (!measure.TryGetProperty("disseminationText", out var label) || label.ValueKind != JsonValueKind.String) continue;
                if (!measure.TryGetProperty("gramWeight", out var grams) || !TryNumber(grams, out var weight)) continue;
                candidates.Add(new FoodPortion(label.GetString()!, weight));
            }
        }

        if (food.TryGetProperty("servingSizeUnit", out var unit) && unit.ValueKind == JsonValueKind.String &&
            string.Equals(unit.GetString()?.Trim(), "g", StringComparison.OrdinalIgnoreCase) &&
            food.TryGetProperty("servingSize", out var servingSize) && TryNumber(servingSize, out var servingGrams))
            candidates.Add(new FoodPortion("serving", servingGrams));

        return LimitPortions(candidates);
    }

    public static IReadOnlyList<FoodPortion> MapOffPortions(JsonElement product)
    {
        if (!product.TryGetProperty("serving_quantity", out var quantity) || !TryNumber(quantity, out var grams)) return [];
        var unit = product.TryGetProperty("serving_quantity_unit", out var unitElement) && unitElement.ValueKind == JsonValueKind.String
            ? unitElement.GetString()?.Trim()
            : null;
        if (!string.IsNullOrEmpty(unit) && !string.Equals(unit, "g", StringComparison.OrdinalIgnoreCase)) return [];
        var label = product.TryGetProperty("serving_size", out var size) && size.ValueKind == JsonValueKind.String
            ? size.GetString()?.Trim()
            : null;
        return LimitPortions([new FoodPortion(string.IsNullOrWhiteSpace(label) ? "serving" : label!, grams)]);
    }

    public static IReadOnlyList<FoodPortion> LimitPortions(IEnumerable<FoodPortion> portions)
    {
        var result = new List<FoodPortion>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var portion in portions)
        {
            var label = portion.Label.Trim();
            if (label.Length is < 1 or > 24 || !double.IsFinite(portion.Grams) || portion.Grams is < .1 or > 10000) continue;
            if (!seen.Add(label)) continue;
            result.Add(new FoodPortion(label, portion.Grams));
            if (result.Count == 12) break;
        }
        return result;
    }

    private static bool TryNumber(JsonElement value, out double number)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out number)) return true;
        if (value.ValueKind == JsonValueKind.String && double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out number)) return true;
        number = 0;
        return false;
    }
}
