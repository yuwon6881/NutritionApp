using System.Net;
using System.Text.Json;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;
public record FoodPortion(string Label,double Grams);
public record FoodResult(string Name,double Calories,double? Protein,double? Fat,double? Carbs,double? Fiber,string Source,double ServingGrams=100,IReadOnlyList<FoodPortion>? Portions=null,string? Code=null,double? ServingCalories=null,string Basis="per100g");
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
    // Open Food Facts' /api/v2/search allowance is ten reads per minute per IP.
    // The old one-second slot could exceed that limit as soon as two instances
    // shared the egress address. Keep hydration best-effort and pace it below the
    // published limit; the search result itself remains immediately usable.
    private const double BatchProductIntervalSeconds=6.1;
    // Search-a-licious does not index the serving fields. The bulk product request fills them for
    // the list without making one metered barcode request per result.
    private const string SearchFields="code,product_name,product_name_en,brands,nutriments";
    private const string ProductFields="code,product_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit";
    private const int MaxNameLength=160;
    private static readonly SemaphoreSlim RateGate=new(1);
    private static DateTime nextBarcode=DateTime.MinValue;
    private static DateTime nextSearch=DateTime.MinValue;
    private static DateTime nextBatchProduct=DateTime.MinValue;

    public Task<IReadOnlyList<FoodResult>> Search(string query,CancellationToken ct)
        => SearchCore(query,null,ct);

    private async Task<IReadOnlyList<FoodResult>> SearchCore(string query,AppDb? db,CancellationToken ct)
    {
        query=query.Trim(); Validation.Require(query.Length is >=2 and <=100,"Enter 2–100 characters.");
        // Bump this when the provider-basis mapping changes so a process does not keep serving
        // search rows cached under the old (possibly serving-labelled-as-100 g) basis.
        var key="search:hydrated-v3:"+query.ToLowerInvariant();
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
                    if(ReadProduct(hit,null,"unverified") is {} result) results.Add(result);
            await EnrichSearchResults(results,db,ct);
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

    /// <summary>
    /// Applies account-specific food frequency after the provider response has been read. The
    /// provider cache remains shared and unpersonalized; only the final ordering uses this account's
    /// non-deleted diary entries.
    /// </summary>
    public async Task<IReadOnlyList<FoodResult>> Search(string query,AppDb db,CancellationToken ct)
    {
        var results=await SearchCore(query,db,ct);
        return await RankForUser(results,query,db,ct);
    }

    public async Task<IReadOnlyList<FoodResult>> RankForUser(IReadOnlyList<FoodResult> results,string query,AppDb db,CancellationToken ct)
    {
        if(results.Count==0)return results;
        var frequency=await UsageCounts(results,db,ct);
        return PrioritizeResults(results,query,frequency);
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

    public async Task<FoodResult> Barcode(string code,AppDb db,CancellationToken ct)
    {
        Validation.Require(code.Length is >=8 and <=14 && code.All(char.IsAsciiDigit),"Enter an 8–14 digit barcode.");
        var local=await db.Foods.AsNoTracking().SingleOrDefaultAsync(food=>!food.Deleted&&food.Barcode==code,ct);
        if(local is not null)
        {
            var portions=ParseStoredPortions(local.PortionsJson);
            return new FoodResult(local.Name,local.Calories,local.Protein,local.Fat,local.Carbs,local.Fiber,local.Source,local.ServingGrams,portions,code,ServingCalories(local.Calories,portions),"per100g");
        }
        if(cache.TryGetValue<FoodResult>("barcode:"+code,out var saved)) return saved!;
        var durable=await db.PublicFoodProducts.AsNoTracking()
            .SingleOrDefaultAsync(product=>product.Code==code&&product.ExpiresAt>DateTime.UtcNow,ct);
        if(durable is not null&&TryReadCached(durable.ResultJson) is { } durableResult)
        {
            cache.Set("barcode:"+code,durableResult,new MemoryCacheEntryOptions { Size=1,AbsoluteExpirationRelativeToNow=TimeSpan.FromDays(1) });
            return durableResult;
        }
        await RateGate.WaitAsync(ct);
        // No slot is returned here on failure: the request reached a metered endpoint and counted
        // against its allowance whatever it answered.
        try { Validation.Require(DateTime.UtcNow>=nextBarcode,"Wait four seconds before another barcode lookup.",429); nextBarcode=DateTime.UtcNow.AddSeconds(BarcodeIntervalSeconds); }
        finally { RateGate.Release(); }
        HttpResponseMessage response;
        try
        {
            response=await http.GetAsync($"{ProductUrl}{code}?fields={ProductFields}",ct);
        }
        catch(HttpRequestException)
        {
            throw new DomainException("Barcode lookup unavailable at Open Food Facts. Retry when connected or use manual recovery.",503);
        }
        catch(TaskCanceledException) when(!ct.IsCancellationRequested)
        {
            throw new DomainException("Barcode lookup timed out at Open Food Facts. Retry or use manual recovery.",503);
        }
        using(response)
        {
            if(response.StatusCode==HttpStatusCode.NotFound)
                throw new DomainException("Barcode not found. Scan the label or add a custom food.",404);
            if(response.StatusCode==HttpStatusCode.TooManyRequests)
                throw new DomainException("Barcode lookup is busy at Open Food Facts. Retry in a few seconds or use manual recovery.",429);
            Validation.Require(response.IsSuccessStatusCode,"Barcode lookup unavailable. Scan the label or enter this food manually.",503);
            JsonDocument json;
            try
            {
                var payload=await response.Content.ReadAsStringAsync(ct);
                json=JsonDocument.Parse(payload);
            }
            catch(TaskCanceledException) when(!ct.IsCancellationRequested)
            {
                throw new DomainException("Barcode lookup timed out at Open Food Facts. Retry or use manual recovery.",503);
            }
            catch(HttpRequestException)
            {
                throw new DomainException("Barcode lookup unavailable at Open Food Facts. Retry when connected or use manual recovery.",503);
            }
            catch(JsonException)
            {
                throw new DomainException("Barcode lookup returned invalid product data. Retry or use manual recovery.",503);
            }
            using(json)
            {
                Validation.Require(json.RootElement.TryGetProperty("product",out var product),"Barcode not found. Scan the label or add a custom food.",404);
                Validation.Require(Calories(product)!=null,"This product has no calorie data. Scan its label.",422);
                var result=ReadProduct(product,code,"per100g")!;
                cache.Set("barcode:"+code,result,new MemoryCacheEntryOptions { Size=1,AbsoluteExpirationRelativeToNow=TimeSpan.FromDays(1) });
                await StorePublicProducts(db,[result],DateTime.UtcNow.AddDays(1),ct);
                return result;
            }
        }
    }

    private static IReadOnlyList<FoodPortion> ParseStoredPortions(string json)
    {
        try
        {
            using var document=JsonDocument.Parse(json);
            if(document.RootElement.ValueKind!=JsonValueKind.Array)return [];
            var portions=new List<FoodPortion>();
            foreach(var item in document.RootElement.EnumerateArray())
            {
                if(item.ValueKind!=JsonValueKind.Object||!item.TryGetProperty("label",out var label)||label.ValueKind!=JsonValueKind.String||!item.TryGetProperty("grams",out var grams)||!TryNumber(grams,out var value))continue;
                portions.Add(new FoodPortion(label.GetString()??"",value));
            }
            return LimitPortions(portions);
        }
        catch(JsonException){return [];}
    }

    /// <summary>
    /// Maps one Open Food Facts product. A scanned barcode supplies its own code and keeps the
    /// generic name a label scan can still correct; a search hit without a name or calories is
    /// dropped, because an unnamed or calorie-less row cannot be logged honestly.
    /// </summary>
    public static FoodResult? ReadProduct(JsonElement product,string? scanned,string? basis=null)
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
            100,portions,code,ServingCalories(calories,portions),
            basis??(scanned is not null?"per100g":"unverified"));
    }

    private async Task EnrichSearchResults(List<FoodResult> results,AppDb? db,CancellationToken ct)
    {
        var codes=results.Select(result=>result.Code).OfType<string>().Where(code=>code.Length>0).Distinct(StringComparer.Ordinal).ToArray();
        if(codes.Length==0)return;
        var missing=codes.ToHashSet(StringComparer.Ordinal);
        if(db is not null)
        {
            var now=DateTime.UtcNow;
            var cached=await db.PublicFoodProducts.AsNoTracking()
                .Where(product=>codes.Contains(product.Code)&&product.ExpiresAt>now).ToListAsync(ct);
            foreach(var row in cached)
            {
                if(TryReadCached(row.ResultJson) is not { } hydrated)continue;
                missing.Remove(row.Code);
                for(var index=0;index<results.Count;index++)
                    if(results[index].Code==row.Code)results[index]=ApplyHydratedProduct(results[index],hydrated);
            }
        }
        if(missing.Count==0)return;
        try
        {
            var wait=await ReserveBatchProductSlot(ct);
            if(wait>TimeSpan.Zero)await Task.Delay(wait,ct);
            using var response=await http.GetAsync($"{BatchProductUrl}?code={Uri.EscapeDataString(string.Join(',',missing))}&fields={Uri.EscapeDataString(ProductFields)}&page_size={missing.Count}",ct);
            if(!response.IsSuccessStatusCode)return;
            using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if(!json.RootElement.TryGetProperty("products",out var products)||products.ValueKind!=JsonValueKind.Array)return;
            var hydratedByCode=new Dictionary<string,FoodResult>(StringComparer.Ordinal);
            foreach(var product in products.EnumerateArray())
            {
                var code=Code(product);
                if(code is {Length:>0}&&ReadProduct(product,code,"per100g") is {} hydrated)hydratedByCode[code]=hydrated;
            }
            for(var index=0;index<results.Count;index++)
            {
                var result=results[index];
                if(result.Code is {Length:>0} code&&hydratedByCode.TryGetValue(code,out var hydrated))
                    results[index]=ApplyHydratedProduct(result,hydrated);
            }
            if(db is not null&&hydratedByCode.Count>0)
                await StorePublicProducts(db,hydratedByCode.Values,DateTime.UtcNow.AddDays(1),ct);
        }
        catch(OperationCanceledException){throw;}
        catch
        {
            // Serving hydration improves the search list but must not make free-text search fail.
        }
    }

    private static FoodResult? TryReadCached(string json)
    {
        try { return Json.Read<FoodResult>(json); }
        catch (JsonException) { return null; }
        catch (DomainException) { return null; }
    }

    private static async Task StorePublicProducts(AppDb db,IEnumerable<FoodResult> results,DateTime expiresAt,CancellationToken ct)
    {
        var rows=results.Where(result=>result.Code is {Length:>0}).ToList();
        if(rows.Count==0)return;
        try
        {
            var codes=rows.Select(result=>result.Code!).Distinct(StringComparer.Ordinal).ToArray();
            var existing=await db.PublicFoodProducts.Where(product=>codes.Contains(product.Code)).ToDictionaryAsync(product=>product.Code,StringComparer.Ordinal,ct);
            foreach(var result in rows)
            {
                var code=result.Code!;
                if(!existing.TryGetValue(code,out var row))
                {
                    row=new PublicFoodProduct { Code=code };
                    db.PublicFoodProducts.Add(row); existing[code]=row;
                }
                row.ResultJson=Json.Write(result); row.ExpiresAt=expiresAt; row.UpdatedAt=DateTime.UtcNow;
            }
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Two instances can hydrate the same public product. The unique code is the
            // coordination boundary; a losing cache write must never make search fail.
            foreach(var entry in db.ChangeTracker.Entries<PublicFoodProduct>()) entry.State=EntityState.Detached;
        }
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
    /// Keeps the provider's name relevance ahead of personal frequency, then prefers a declared gram
    /// serving and provider order. Frequency is counted from logged diary entries and only breaks
    /// equivalent name matches, so personalization cannot make a weakly related result outrank a
    /// better match. The search index does not include serving fields, so this ordering must run
    /// after the bulk product hydration step.
    /// </summary>
    public static IReadOnlyList<FoodResult> PrioritizeResults(IEnumerable<FoodResult> results,string query,IReadOnlyDictionary<string,int>? frequencies=null)
    {
        var needle=NormalizeSearchText(query);
        var queryTokens=SearchTokens(query);
        return results
            .Select((result,index)=>new
            {
                result,
                index,
                nameRank=SearchNameRank(result.Name,needle,queryTokens),
                frequency=Frequency(result,frequencies),
                hasServing=result.Portions?.Count>0,
            })
            .OrderBy(item=>item.nameRank)
            .ThenByDescending(item=>item.frequency)
            .ThenByDescending(item=>item.hasServing)
            .ThenBy(item=>item.index)
            .Select(item=>item.result)
            .ToArray();
    }

    /// <summary>
    /// A product with a code keeps its identity even when its display name is edited after logging.
    /// Code-bearing Open Food Facts sources include that code; code-less results fall back to their
    /// normalized source and name. This lets old diary rows contribute without a schema migration.
    /// </summary>
    public static string UsageKey(FoodResult result)
        =>result.Code is {Length:>0}
            ? "code:"+result.Source
            : NameUsageKey(result.Source,result.Name);

    private static int Frequency(FoodResult result,IReadOnlyDictionary<string,int>? frequencies)
        =>frequencies is not null&&frequencies.TryGetValue(UsageKey(result),out var count)?count:0;

    private static string NameUsageKey(string source,string name)
        =>"name:"+source+"\u001f"+NormalizeSearchText(name);

    private static async Task<IReadOnlyDictionary<string,int>> UsageCounts(IReadOnlyList<FoodResult> results,AppDb db,CancellationToken ct)
    {
        var sources=results.Select(result=>result.Source).Distinct(StringComparer.Ordinal).ToArray();
        if(sources.Length==0)return new Dictionary<string,int>(StringComparer.Ordinal);

        var sourceCounts=await db.Entries.AsNoTracking()
            .Where(entry=>!entry.Deleted&&sources.Contains(entry.Source))
            .GroupBy(entry=>entry.Source)
            .Select(group=>new {Source=group.Key,Count=group.Count()})
            .ToDictionaryAsync(row=>row.Source,row=>row.Count,StringComparer.Ordinal,ct);
        // Group in SQL first, then normalize the relatively small set of distinct
        // names. This avoids materializing every historical diary row for ranking.
        var distinctNames=await db.Entries.AsNoTracking()
            .Where(entry=>!entry.Deleted&&sources.Contains(entry.Source))
            .GroupBy(entry=>new {entry.Source,entry.Name})
            .Select(group=>new {group.Key.Source,group.Key.Name,Count=group.Count()})
            .ToListAsync(ct);
        var nameCounts=new Dictionary<string,int>(StringComparer.Ordinal);
        foreach(var entry in distinctNames)
        {
            var key=NameUsageKey(entry.Source,entry.Name);
            nameCounts[key]=nameCounts.GetValueOrDefault(key)+entry.Count;
        }
        var resultCounts=new Dictionary<string,int>(StringComparer.Ordinal);
        foreach(var result in results)
        {
            var count=result.Code is {Length:>0}
                ? sourceCounts.GetValueOrDefault(result.Source)
                : nameCounts.GetValueOrDefault(NameUsageKey(result.Source,result.Name));
            resultCounts[UsageKey(result)]=count;
        }
        return resultCounts;
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
