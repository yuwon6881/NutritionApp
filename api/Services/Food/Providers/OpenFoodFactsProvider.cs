using System.Net;
using System.Text.Json;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Open Food Facts: packaged products and the best open source for Malaysian barcodes. Free text
/// runs on Search-a-licious, the Elasticsearch service that replaced cgi/search.pl; barcode lookup
/// and serving hydration use the product API. Search results are hydrated in one bulk request so
/// the list and editor share the same declared gram serving.
/// </summary>
public sealed class OpenFoodFactsProvider(HttpClient http):IFoodProvider
{
    public const string ProviderId="off";
    private const string SearchUrl="https://search.openfoodfacts.org/search";
    private const string ProductUrl="https://world.openfoodfacts.org/api/v2/product/";
    private const string BatchProductUrl="https://world.openfoodfacts.org/api/v2/search";
    // Search pacing is courtesy rather than quota: Search-a-licious is not metered per IP. The
    // product endpoint still is, at roughly 15 reads a minute shared by everyone behind the egress.
    private static readonly TimeSpan SearchInterval=TimeSpan.FromSeconds(1);
    private static readonly TimeSpan MaxSearchWait=TimeSpan.FromSeconds(3);
    private static readonly TimeSpan BusyBackoff=TimeSpan.FromSeconds(10);
    private static readonly TimeSpan BarcodeInterval=TimeSpan.FromSeconds(4.1);
    // /api/v2/search allows ten reads per minute per IP. A one-second slot could exceed that as soon
    // as two instances shared the egress address, so hydration stays best-effort and paced below it.
    private static readonly TimeSpan BatchProductInterval=TimeSpan.FromSeconds(6.1);
    // Search-a-licious does not index the serving fields; the bulk product request fills them.
    private const string SearchFields="code,product_name,product_name_en,brands,nutriments";
    private const string ProductFields="code,product_name,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit";
    private static readonly ProviderGate SearchGate=new();
    private static readonly ProviderGate BarcodeGate=new();
    private static readonly ProviderGate BatchProductGate=new();

    public string Id=>ProviderId;
    public string Name=>"Open Food Facts";
    public FoodCapability Capabilities=>FoodCapability.Search|FoodCapability.Barcode;
    // Pacing can hold a search for three seconds and hydration waits for its own slot, so this
    // provider gets longer than the network default before a merge gives up on it.
    public TimeSpan SearchTimeout=>TimeSpan.FromSeconds(15);
    public TimeSpan? DurableLifetime=>TimeSpan.FromDays(1);

    public async Task<IReadOnlyList<FoodResult>> Search(string query,PublicFoodCache? durable,CancellationToken ct)
    {
        // The gate paces Open Food Facts, not the person typing: an early request waits for its slot.
        if(await SearchGate.Reserve(SearchInterval,MaxSearchWait,ct) is not { } slot)
            throw new FoodProviderException(ProviderId,FoodProviderFailure.Throttled);
        try
        {
            if(slot.Wait>TimeSpan.Zero)await Task.Delay(slot.Wait,ct);
            using var response=await Send($"{SearchUrl}?page_size=12&fields={SearchFields}&q={Uri.EscapeDataString(query)}",ct);
            if(response.StatusCode==HttpStatusCode.TooManyRequests)
            {
                // A shed answer is a real instruction to back off, not to resume the one-second pace.
                await SearchGate.Hold(DateTime.UtcNow.Add(BusyBackoff));
                throw new FoodProviderException(ProviderId,FoodProviderFailure.Busy,BusyBackoff);
            }
            if(!response.IsSuccessStatusCode)throw new FoodProviderException(ProviderId,SearchFailure(response.StatusCode));
            var results=new List<FoodResult>();
            using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if(json.RootElement.TryGetProperty("hits",out var hits)&&hits.ValueKind==JsonValueKind.Array)
                foreach(var hit in hits.EnumerateArray())
                    if(OpenFoodFactsParser.ReadProduct(hit,null,"unverified") is {} result)results.Add(result);
            await Hydrate(results,durable,ct);
            return results;
        }
        catch(FoodProviderException failure) when(failure.Failure==FoodProviderFailure.Busy) { throw; }
        catch
        {
            // Any other failure hands its slot back, or the retry the error message asks for is
            // answered by our own limit instead of reaching Open Food Facts.
            await SearchGate.Return(slot);
            throw;
        }
    }

    /// <summary>Open Food Facts sheds search load under pressure; only a 429 means back off.</summary>
    public static FoodProviderFailure SearchFailure(HttpStatusCode status)
        =>status==HttpStatusCode.TooManyRequests?FoodProviderFailure.Busy:FoodProviderFailure.Unavailable;

    public async Task<FoodResult?> Barcode(string code,CancellationToken ct)
    {
        // No slot is returned on failure: the request reached a metered endpoint and counted
        // against its allowance whatever it answered.
        if(!await BarcodeGate.TryClaim(BarcodeInterval,ct))
            throw new FoodProviderException(ProviderId,FoodProviderFailure.Throttled,BarcodeInterval);
        using var response=await Send($"{ProductUrl}{code}?fields={ProductFields}",ct);
        if(response.StatusCode==HttpStatusCode.NotFound)return null;
        if(response.StatusCode==HttpStatusCode.TooManyRequests)throw new FoodProviderException(ProviderId,FoodProviderFailure.Busy);
        if(!response.IsSuccessStatusCode)throw new FoodProviderException(ProviderId,FoodProviderFailure.Unavailable);
        using var json=await ReadJson(response,ct);
        if(!json.RootElement.TryGetProperty("product",out var product))return null;
        if(OpenFoodFactsParser.Calories(product) is null)throw new FoodProviderException(ProviderId,FoodProviderFailure.Incomplete);
        return OpenFoodFactsParser.ReadProduct(product,code,"per100g");
    }

    private async Task Hydrate(List<FoodResult> results,PublicFoodCache? durable,CancellationToken ct)
    {
        var codes=results.Select(result=>result.Code).OfType<string>().Where(code=>code.Length>0).Distinct(StringComparer.Ordinal).ToArray();
        if(codes.Length==0)return;
        var missing=codes.ToHashSet(StringComparer.Ordinal);
        if(durable is not null)
        {
            var cached=await durable.Read(ProviderId,codes,ct);
            foreach(var (code,hydrated) in cached)
            {
                missing.Remove(code);
                Apply(results,code,hydrated);
            }
        }
        if(missing.Count==0)return;
        try
        {
            var slot=await BatchProductGate.Reserve(BatchProductInterval,null,ct);
            if(slot!.Value.Wait>TimeSpan.Zero)await Task.Delay(slot.Value.Wait,ct);
            using var response=await http.GetAsync($"{BatchProductUrl}?code={Uri.EscapeDataString(string.Join(',',missing))}&fields={Uri.EscapeDataString(ProductFields)}&page_size={missing.Count}",ct);
            if(!response.IsSuccessStatusCode)return;
            using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if(!json.RootElement.TryGetProperty("products",out var products)||products.ValueKind!=JsonValueKind.Array)return;
            var hydratedByCode=new Dictionary<string,FoodResult>(StringComparer.Ordinal);
            foreach(var product in products.EnumerateArray())
            {
                var code=OpenFoodFactsParser.Code(product);
                if(code is {Length:>0}&&OpenFoodFactsParser.ReadProduct(product,code,"per100g") is {} hydrated)hydratedByCode[code]=hydrated;
            }
            foreach(var (code,hydrated) in hydratedByCode)Apply(results,code,hydrated);
            if(durable is not null&&hydratedByCode.Count>0)
                await durable.Store(ProviderId,hydratedByCode.Values,DateTime.UtcNow.Add(DurableLifetime!.Value),ct);
        }
        catch(OperationCanceledException) when(ct.IsCancellationRequested){throw;}
        catch
        {
            // Serving hydration improves the search list but must not make free-text search fail.
        }
    }

    private static void Apply(List<FoodResult> results,string code,FoodResult hydrated)
    {
        for(var index=0;index<results.Count;index++)
            if(results[index].Code==code)results[index]=OpenFoodFactsParser.ApplyHydratedProduct(results[index],hydrated);
    }

    private async Task<HttpResponseMessage> Send(string url,CancellationToken ct)
    {
        try { return await http.GetAsync(url,ct); }
        catch(HttpRequestException) { throw new FoodProviderException(ProviderId,FoodProviderFailure.Unreachable); }
        catch(TaskCanceledException) when(!ct.IsCancellationRequested) { throw new FoodProviderException(ProviderId,FoodProviderFailure.TimedOut); }
    }

    private static async Task<JsonDocument> ReadJson(HttpResponseMessage response,CancellationToken ct)
    {
        try { return JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct)); }
        catch(TaskCanceledException) when(!ct.IsCancellationRequested) { throw new FoodProviderException(ProviderId,FoodProviderFailure.TimedOut); }
        catch(HttpRequestException) { throw new FoodProviderException(ProviderId,FoodProviderFailure.Unreachable); }
        catch(JsonException) { throw new FoodProviderException(ProviderId,FoodProviderFailure.InvalidData); }
    }
}
