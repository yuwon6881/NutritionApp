using System.Net;
using System.Text.Json;
using System.Globalization;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;
public record FoodPortion(string Label,double Grams);
public record FoodResult(string Name,double Calories,double? Protein,double? Fat,double? Carbs,double? Fiber,string Source,double ServingGrams=100,IReadOnlyList<FoodPortion>? Portions=null,string? Code=null,double? ServingCalories=null);
public sealed class FoodSearchService(HttpClient http,IMemoryCache cache)
{
    // Free text runs on Search-a-licious, the Elasticsearch service Open Food Facts built to
    // replace cgi/search.pl. The legacy endpoint sheds load per IP and every request here leaves
    // from the one Cloud Run egress address, so a shed answer was app-wide rather than per user.
    // Barcode lookup and serving hydration use the Open Food Facts product API. Search results are
    // hydrated in one bulk request so the list and editor share the same declared gram serving.
    private const string SearchUrl="https://search.openfoodfacts.org/search";
    private const string ProductUrl="https://world.openfoodfacts.org/api/v2/product/";
    private const string BatchProductUrl="https://world.openfoodfacts.org/api/v2/search";
    // Search pacing is courtesy rather than quota: Search-a-licious is not metered per IP. The
    // product endpoint still is, at roughly 15 reads a minute shared by everyone behind the egress.
    // The search gate paces Open Food Facts, not the person typing, so a request that arrives early
    // waits for its slot instead of failing; only a queue deeper than the cap is refused.
    private const double SearchIntervalSeconds=1;
    private const double MaxSearchWaitSeconds=3;
    private const double BusyBackoffSeconds=10;
    private const double BarcodeIntervalSeconds=4.1;
    private const double BatchProductIntervalSeconds=1;
    // Search-a-licious does not index the serving fields. The bulk product request fills them for
    // the list without making one metered barcode request per result.
    private const string SearchFields="code,product_name,product_name_en,brands,nutriments";
    private const string ProductFields="code,product_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit";
    private const int MaxNameLength=160;
    private static readonly SemaphoreSlim RateGate=new(1);
    private static DateTime nextBarcode=DateTime.MinValue;
    private static DateTime nextSearch=DateTime.MinValue;
    private static DateTime nextBatchProduct=DateTime.MinValue;

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
            await EnrichSearchResults(results,ct);
            var prioritized=PrioritizeResults(results,query);
            cache.Set(key,prioritized,new MemoryCacheEntryOptions { Size=1,AbsoluteExpirationRelativeToNow=TimeSpan.FromHours(6) }); return prioritized;
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
        var code=scanned??Code(product);
        double? N(string key)=>Nutrient(product,key);
        var portions=MapPortions(product);
        return new FoodResult(
            Label(name??"Packaged food",Brand(product)),
            calories,N("proteins"),N("fat"),N("carbohydrates"),N("fiber"),
            code is null?"Open Food Facts / ODbL":"Open Food Facts / ODbL / "+code,
            100,portions,code,ServingCalories(calories,portions));
    }

    private async Task EnrichSearchResults(List<FoodResult> results,CancellationToken ct)
    {
        var codes=results.Select(result=>result.Code).OfType<string>().Where(code=>code.Length>0).Distinct(StringComparer.Ordinal).ToArray();
        if(codes.Length==0)return;
        try
        {
            var wait=await ReserveBatchProductSlot(ct);
            if(wait>TimeSpan.Zero)await Task.Delay(wait,ct);
            using var response=await http.GetAsync($"{BatchProductUrl}?code={Uri.EscapeDataString(string.Join(',',codes))}&fields={Uri.EscapeDataString(ProductFields)}&page_size={codes.Length}",ct);
            if(!response.IsSuccessStatusCode)return;
            using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if(!json.RootElement.TryGetProperty("products",out var products)||products.ValueKind!=JsonValueKind.Array)return;
            var portionsByCode=new Dictionary<string,IReadOnlyList<FoodPortion>>(StringComparer.Ordinal);
            foreach(var product in products.EnumerateArray())
            {
                var code=Code(product);
                if(code is not null)portionsByCode[code]=MapPortions(product);
            }
            for(var index=0;index<results.Count;index++)
            {
                var result=results[index];
                if(result.Code is {Length:>0} code&&portionsByCode.TryGetValue(code,out var portions))
                    results[index]=result with {Portions=portions,ServingCalories=ServingCalories(result.Calories,portions)};
            }
        }
        catch(OperationCanceledException){throw;}
        catch
        {
            // Serving hydration improves the search list but must not make free-text search fail.
        }
    }

    /// <summary>
    /// Keeps the provider's name relevance ahead of portion availability, then prefers a declared
    /// gram serving when names are equivalent. The search index does not include serving fields,
    /// so this ordering must run after the bulk product hydration step.
    /// </summary>
    public static IReadOnlyList<FoodResult> PrioritizeResults(IEnumerable<FoodResult> results,string query)
    {
        var needle=NormalizeSearchText(query);
        var queryTokens=SearchTokens(query);
        return results
            .Select((result,index)=>new
            {
                result,
                index,
                nameRank=SearchNameRank(result.Name,needle,queryTokens),
                hasServing=result.Portions?.Count>0,
            })
            .OrderBy(item=>item.nameRank)
            .ThenByDescending(item=>item.hasServing)
            .ThenBy(item=>item.index)
            .Select(item=>item.result)
            .ToArray();
    }

    private static int SearchNameRank(string name,string needle,IReadOnlyList<string> queryTokens)
    {
        var candidateText=name.Split(" · ",2,StringSplitOptions.None)[0];
        var candidate=NormalizeSearchText(candidateText);
        if(needle.Length==0||candidate.Length==0)return 0;
        if(string.Equals(candidate,needle,StringComparison.Ordinal))return 0;
        if(candidate.StartsWith(needle,StringComparison.Ordinal))return 1;
        if(candidate.Contains(needle,StringComparison.Ordinal))return 2;
        var candidateTokens=SearchTokens(candidateText);
        var matched=queryTokens.Count(token=>candidateTokens.Contains(token,StringComparer.Ordinal));
        return matched==queryTokens.Count?3:matched>0?4+(queryTokens.Count-matched):100;
    }

    private static string[] SearchTokens(string value)
        =>value.Split([' ', '-', '_', '/', ',', '.', '(', ')', '[', ']', ':', ';'],StringSplitOptions.RemoveEmptyEntries)
            .Select(NormalizeSearchText)
            .Where(token=>token.Length>0)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

    private static string NormalizeSearchText(string value)
        =>new string(value.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());

    private static async Task<TimeSpan> ReserveBatchProductSlot(CancellationToken ct)
    {
        await RateGate.WaitAsync(ct);
        try
        {
            var now=DateTime.UtcNow;
            var start=nextBatchProduct>now?nextBatchProduct:now;
            nextBatchProduct=start.AddSeconds(BatchProductIntervalSeconds);
            return start-now;
        }
        finally { RateGate.Release(); }
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

    private static double? ServingCalories(double calories,IReadOnlyList<FoodPortion> portions)
        =>portions.FirstOrDefault() is { } portion?calories*portion.Grams/100:null;

    private static double? Nutrient(JsonElement product,string key)=>
        product.TryGetProperty("nutriments",out var nutrients)&&nutrients.ValueKind==JsonValueKind.Object
        &&nutrients.TryGetProperty(key+"_100g",out var value)&&TryNumber(value,out var number)?number:null;

    private static string? Text(JsonElement product,string name)=>
        product.TryGetProperty(name,out var value)&&value.ValueKind==JsonValueKind.String
        &&value.GetString()?.Trim() is {Length:>0} text?text:null;

    private static string? Code(JsonElement product)
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
