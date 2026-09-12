using System.Net;
using System.Text.Json;
using System.Globalization;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;
public record FoodPortion(string Label,double Grams);
public record FoodResult(string Name,double Calories,double? Protein,double? Fat,double? Carbs,double? Fiber,string Source,double ServingGrams=100,IReadOnlyList<FoodPortion>? Portions=null,string? Code=null);
public sealed class FoodSearchService(HttpClient http,IMemoryCache cache)
{
    // Free text runs on Search-a-licious, the Elasticsearch service Open Food Facts built to
    // replace cgi/search.pl. The legacy endpoint sheds load per IP and every request here leaves
    // from the one Cloud Run egress address, so a shed answer was app-wide rather than per user.
    // Barcode lookup stays on the product endpoint, which is not part of that shedding and is the
    // only source carrying a declared serving.
    private const string SearchUrl="https://search.openfoodfacts.org/search";
    private const string ProductUrl="https://world.openfoodfacts.org/api/v2/product/";
    // Search pacing is courtesy rather than quota: Search-a-licious is not metered per IP. The
    // product endpoint still is, at roughly 15 reads a minute shared by everyone behind the egress.
    // The search gate paces Open Food Facts, not the person typing, so a request that arrives early
    // waits for its slot instead of failing; only a queue deeper than the cap is refused.
    private const double SearchIntervalSeconds=1;
    private const double MaxSearchWaitSeconds=3;
    private const double BusyBackoffSeconds=10;
    private const double BarcodeIntervalSeconds=4.1;
    // Search-a-licious does not index the serving fields, so a search hit carries no portion and
    // selection fetches product details on demand to obtain a declared serving.
    private const string SearchFields="code,product_name,product_name_en,brands,nutriments";
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
        var claimed=DateTime.MinValue; var released=DateTime.MinValue; var wait=TimeSpan.Zero;
        await RateGate.WaitAsync(ct);
        try
        {
            var now=DateTime.UtcNow;
            var start=nextSearch>now?nextSearch:now;
            wait=start-now;
            Validation.Require(wait.TotalSeconds<=MaxSearchWaitSeconds,"Please wait a moment before searching again.",429);
            released=nextSearch; nextSearch=claimed=start.AddSeconds(SearchIntervalSeconds);
        }
        finally { RateGate.Release(); }
        var results=new List<FoodResult>();
        try
        {
            if(wait>TimeSpan.Zero) await Task.Delay(wait,ct);
            using var response=await http.GetAsync($"{SearchUrl}?page_size=12&fields={SearchFields}&q={Uri.EscapeDataString(query)}",ct);
            if(!response.IsSuccessStatusCode) throw SearchUnavailable(response.StatusCode);
            using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if(json.RootElement.TryGetProperty("hits",out var hits)&&hits.ValueKind==JsonValueKind.Array)
                foreach(var hit in hits.EnumerateArray())
                    if(ReadProduct(hit,null) is {} result) results.Add(result);
        }
        catch(DomainException busy) when(busy.Status==429)
        {
            // Only Open Food Facts can reach here with a 429, and it means back off in earnest
            // rather than resume the ordinary one-second pace.
            await HoldSearch(DateTime.UtcNow.AddSeconds(BusyBackoffSeconds));
            throw;
        }
        catch
        {
            // Any other failure hands its slot back, or the retry the error message asks for is
            // answered by our own 429 instead of reaching Open Food Facts.
            await ReturnSearchSlot(claimed,released);
            throw;
        }
        cache.Set(key,(IReadOnlyList<FoodResult>)results,new MemoryCacheEntryOptions { Size=1,AbsoluteExpirationRelativeToNow=TimeSpan.FromHours(6) }); return results;
    }

    // Not cancellable: a cancelled or failed search still has to return the slot it claimed, and
    // only while no later search has already claimed one of its own.
    private static async Task ReturnSearchSlot(DateTime claimed,DateTime released)
    {
        await RateGate.WaitAsync(CancellationToken.None);
        try { if(nextSearch==claimed) nextSearch=released; }
        finally { RateGate.Release(); }
    }

    private static async Task HoldSearch(DateTime until)
    {
        await RateGate.WaitAsync(CancellationToken.None);
        try { if(until>nextSearch) nextSearch=until; }
        finally { RateGate.Release(); }
    }

    // Open Food Facts sheds load on search under pressure, which is a wait rather than a fault in
    // the diary, so each failure names the remedy it actually has.
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
        // No slot is returned here on failure: the request reached a metered endpoint and counted
        // against its allowance whatever it answered.
        try { Validation.Require(DateTime.UtcNow>=nextBarcode,"Wait four seconds before another barcode lookup.",429); nextBarcode=DateTime.UtcNow.AddSeconds(BarcodeIntervalSeconds); }
        finally { RateGate.Release(); }
        using var response=await http.GetAsync($"{ProductUrl}{code}?fields={ProductFields}",ct);
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
        var name=Text(product,"product_name")??Text(product,"product_name_en");
        if(name is null&&scanned is null) return null;
        if(Calories(product) is not {} calories) return null;
        var code=scanned??Text(product,"code");
        double? N(string key)=>Nutrient(product,key);
        return new FoodResult(
            Label(name??"Packaged food",Brand(product)),
            calories,N("proteins"),N("fat"),N("carbohydrates"),N("fiber"),
            code is null?"Open Food Facts / ODbL":"Open Food Facts / ODbL / "+code,
            100,MapPortions(product),code);
    }

    /// <summary>
    /// The product endpoint sends brands as one comma-separated string and the search index sends
    /// an array. Both reduce to the leading brand, which is all a label is built from.
    /// </summary>
    public static string? Brand(JsonElement product)
    {
        if(!product.TryGetProperty("brands",out var brands)) return null;
        if(brands.ValueKind==JsonValueKind.String) return brands.GetString();
        if(brands.ValueKind!=JsonValueKind.Array) return null;
        foreach(var brand in brands.EnumerateArray())
            if(brand.ValueKind==JsonValueKind.String&&brand.GetString()?.Trim() is {Length:>0} text) return text;
        return null;
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
    /// app weighs portions in grams, and only water-like liquids convert one to one. Search hits
    /// carry no serving at all, so they arrive here without portions.
    /// </summary>
    public static IReadOnlyList<FoodPortion> MapPortions(JsonElement product)
    {
        if (!product.TryGetProperty("serving_quantity", out var quantity) || !TryNumber(quantity, out var grams)) return [];
        var unit = product.TryGetProperty("serving_quantity_unit", out var unitElement) && unitElement.ValueKind == JsonValueKind.String
            ? unitElement.GetString()?.Trim()
            : null;
        if (!string.IsNullOrEmpty(unit) && !string.Equals(unit, "g", StringComparison.OrdinalIgnoreCase)) return [];
        var label = Text(product, "serving_size");
        if (string.IsNullOrEmpty(unit))
        {
            // Older records omit the normalized unit. Require an explicit gram weight
            // in their label rather than interpreting a scoop or liquid as grams.
            var match = System.Text.RegularExpressions.Regex.Match(label ?? "", @"(?<grams>\d+(?:[.,]\d+)?)\s*g\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!match.Success || !double.TryParse(match.Groups["grams"].Value.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var declared) || declared != grams) return [];
        }
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
