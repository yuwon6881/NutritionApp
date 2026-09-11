using System.Net;
using System.Text.Json;
using System.Globalization;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;
public record FoodPortion(string Label,double Grams);
public record FoodResult(string Name,double Calories,double? Protein,double? Fat,double? Carbs,double? Fiber,string Source,double ServingGrams=100,IReadOnlyList<FoodPortion>? Portions=null);
public sealed class FoodSearchService(HttpClient http,IMemoryCache cache)
{
    // Open Food Facts meters per IP address, not per key: 10 search requests a minute and 15
    // product reads a minute. Every request leaves from the one Cloud Run egress address, so the
    // gates are app-wide rather than per user, and the two allowances are counted separately.
    private const double SearchIntervalSeconds=6;
    private const double BarcodeIntervalSeconds=4.1;
    private const string ProductFields="code,product_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit";
    private const int MaxNameLength=160;
    private static readonly SemaphoreSlim RateGate=new(1);
    private static DateTime nextBarcode=DateTime.MinValue;
    private static DateTime nextSearch=DateTime.MinValue;

    public async Task<IReadOnlyList<FoodResult>> Search(string query,CancellationToken ct)
    {
        query=query.Trim(); Validation.Require(query.Length is >=2 and <=100,"Enter 2–100 characters.");
        var key="search:"+query.ToLowerInvariant();
        if(cache.TryGetValue<IReadOnlyList<FoodResult>>(key,out var saved)) return saved!;
        await RateGate.WaitAsync(ct);
        try { Validation.Require(DateTime.UtcNow>=nextSearch,"Please wait a moment before searching again.",429); nextSearch=DateTime.UtcNow.AddSeconds(SearchIntervalSeconds); }
        finally { RateGate.Release(); }
        // The tag-filter search endpoint cannot match free text and the indexed one drops serving
        // fields, so this is the only Open Food Facts search that ranks by relevance and still
        // carries the declared serving a portion is derived from.
        using var response=await http.GetAsync("https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=12&fields="+ProductFields+"&search_terms="+Uri.EscapeDataString(query),ct);
        if(!response.IsSuccessStatusCode) throw SearchUnavailable(response.StatusCode);
        using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        var results=new List<FoodResult>();
        if(json.RootElement.TryGetProperty("products",out var products)&&products.ValueKind==JsonValueKind.Array)
            foreach(var product in products.EnumerateArray())
                if(ReadProduct(product,null) is {} result) results.Add(result);
        cache.Set(key,(IReadOnlyList<FoodResult>)results,new MemoryCacheEntryOptions { Size=1,AbsoluteExpirationRelativeToNow=TimeSpan.FromHours(6) }); return results;
    }

    // Open Food Facts sheds load on the search endpoint under pressure, which is a wait rather
    // than a fault in the diary, so each failure names the remedy it actually has.
    public static DomainException SearchUnavailable(HttpStatusCode status) => status switch
    {
        HttpStatusCode.TooManyRequests => new DomainException("Food search is busy at Open Food Facts. Wait a few seconds and search again, or use custom food, recent foods, or AI describe.",429),
        _ => new DomainException("Food search is temporarily unavailable. Your diary is still available.",503),
    };

    public async Task<FoodResult> Barcode(string code,CancellationToken ct)
    {
        Validation.Require(code.Length is >=8 and <=14 && code.All(char.IsAsciiDigit),"Enter an 8–14 digit barcode.");
        if(cache.TryGetValue<FoodResult>("barcode:"+code,out var saved)) return saved!;
        await RateGate.WaitAsync(ct);
        try { Validation.Require(DateTime.UtcNow>=nextBarcode,"Wait four seconds before another barcode lookup.",429); nextBarcode=DateTime.UtcNow.AddSeconds(BarcodeIntervalSeconds); }
        finally { RateGate.Release(); }
        using var response=await http.GetAsync($"https://world.openfoodfacts.org/api/v2/product/{code}?fields={ProductFields}",ct);
        Validation.Require(response.IsSuccessStatusCode,"Barcode lookup unavailable. Scan the label or enter this food manually.",503);
        using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        Validation.Require(json.RootElement.TryGetProperty("product",out var product),"Barcode not found. Scan the label or add a custom food.",404);
        Validation.Require(Calories(product)!=null,"This product has no calorie data. Scan its label.",422);
        var result=ReadProduct(product,code)!;
        cache.Set("barcode:"+code,result,new MemoryCacheEntryOptions { Size=1,AbsoluteExpirationRelativeToNow=TimeSpan.FromDays(1) }); return result;
    }

    /// <summary>
    /// Maps one Open Food Facts product. A scanned barcode supplies its own code and keeps the
    /// generic name a label scan can still correct; a search hit without a name or calories is
    /// dropped, because an unnamed or calorie-less row cannot be logged honestly.
    /// </summary>
    public static FoodResult? ReadProduct(JsonElement product,string? scanned)
    {
        var name=Text(product,"product_name");
        if(name is null&&scanned is null) return null;
        if(Calories(product) is not {} calories) return null;
        var code=scanned??Text(product,"code");
        double? N(string key)=>Nutrient(product,key);
        return new FoodResult(
            Label(name??"Packaged food",Text(product,"brands")),
            calories,N("proteins"),N("fat"),N("carbohydrates"),N("fiber"),
            code is null?"Open Food Facts / ODbL":"Open Food Facts / ODbL / "+code,
            100,MapPortions(product));
    }

    /// <summary>
    /// Open Food Facts names repeat heavily across brands—one query returns three products called
    /// "Nasi Goreng"—so the leading brand joins the name to keep a result list distinguishable.
    /// </summary>
    public static string Label(string name,string? brands)
    {
        var brand=brands?.Split(',')[0].Trim();
        var label=string.IsNullOrEmpty(brand)||name.Contains(brand,StringComparison.OrdinalIgnoreCase)?name:name+" · "+brand;
        return label.Length<=MaxNameLength?label:label[..MaxNameLength].TrimEnd();
    }

    private static double? Calories(JsonElement product)=>Nutrient(product,"energy-kcal");

    private static double? Nutrient(JsonElement product,string key)=>
        product.TryGetProperty("nutriments",out var nutrients)&&nutrients.ValueKind==JsonValueKind.Object
        &&nutrients.TryGetProperty(key+"_100g",out var value)&&TryNumber(value,out var number)?number:null;

    private static string? Text(JsonElement product,string name)=>
        product.TryGetProperty(name,out var value)&&value.ValueKind==JsonValueKind.String
        &&value.GetString()?.Trim() is {Length:>0} text?text:null;

    /// <summary>
    /// A declared serving becomes one portion. Servings measured in millilitres are left out: this
    /// app weighs portions in grams, and only water-like liquids convert one to one.
    /// </summary>
    public static IReadOnlyList<FoodPortion> MapPortions(JsonElement product)
    {
        if (!product.TryGetProperty("serving_quantity", out var quantity) || !TryNumber(quantity, out var grams)) return [];
        var unit = product.TryGetProperty("serving_quantity_unit", out var unitElement) && unitElement.ValueKind == JsonValueKind.String
            ? unitElement.GetString()?.Trim()
            : null;
        if (!string.IsNullOrEmpty(unit) && !string.Equals(unit, "g", StringComparison.OrdinalIgnoreCase)) return [];
        var label = Text(product, "serving_size");
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
