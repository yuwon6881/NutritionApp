using System.Net;
using System.Text.Json;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Open Food Facts: packaged products and the best open source for Malaysian barcodes. Free text
/// runs on Search-a-licious, the Elasticsearch service that replaced cgi/search.pl; barcode lookup
/// and serving hydration use the product API. Search results are hydrated in one bulk request so
/// the list and editor share the same declared gram serving.
/// </summary>
public sealed class OpenFoodFactsProvider(HttpClient http,ILogger<OpenFoodFactsProvider>? log=null,OpenFoodFactsPacing? gates=null):IFoodProvider,IFoodBasisVerifier
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
    private static readonly TimeSpan MaxBarcodeWait=TimeSpan.FromSeconds(5);
    // /api/v2/search allows ten reads per minute per IP. A one-second slot could exceed that as soon
    // as two instances shared the egress address, so hydration stays best-effort and paced below it.
    private static readonly TimeSpan BatchProductInterval=TimeSpan.FromSeconds(6.1);
    // Rows confirmed one by one when the bulk read fails; each waits for a 4.1 s barcode slot.
    private const int FallbackReads=3;
    // Search-a-licious does not index the serving fields; the bulk product request fills them.
    // Search-a-licious ranks by its own relevance and popularity; a wider page lets the shared
    // ranking find the product the person named behind a heavily scanned brand family.
    private const int SearchPageSize=50;
    private const int HydratedRows=FoodResultMerger.MaxResults;
    private const string SearchFields="code,product_name,product_name_en,brands,nutriments";
    private const string ProductFields="code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,quantity,product_quantity_unit";
    private readonly OpenFoodFactsPacing pacing=gates??OpenFoodFactsPacing.Shared;
    private ProviderGate SearchGate=>pacing.Search;
    private ProviderGate BarcodeGate=>pacing.Barcode;
    private ProviderGate BatchProductGate=>pacing.BatchProduct;

    public string Id=>ProviderId;
    public string Name=>"Open Food Facts";
    public FoodCapability Capabilities=>FoodCapability.Search|FoodCapability.Barcode;
    // Pacing can hold a search for three seconds and hydration waits for its own slot, so this
    // provider gets longer than the network default before a merge gives up on it.
    public TimeSpan SearchTimeout=>TimeSpan.FromSeconds(15);
    public TimeSpan? DurableLifetime=>TimeSpan.FromDays(1);

    public async Task<IReadOnlyList<FoodResult>> Search(string query,PublicFoodCache? durable,CancellationToken ct)
    {
        var (results,brands)=await ReadHits(query,SearchGate,required:true,ct);
        if(OpenFoodFactsQuery.BrandFollowUp(query,results,brands) is { } followUp)
        {
            var (scoped,_)=await ReadHits(followUp,pacing.SearchFollowUp,required:false,ct);
            var known=results.Select(result=>result.Code).OfType<string>().ToHashSet(StringComparer.Ordinal);
            results.AddRange(scoped.Where(result=>result.Code is null||known.Add(result.Code)));
        }
        // A wide page gives the shared ranking real candidates; only the best of them are hydrated,
        // so the bulk product read stays as small as before.
        var kept=FoodRanking.PrioritizeResults(results,query).Take(HydratedRows).ToList();
        await Hydrate(kept,durable,ct);
        return kept;
    }

    /// <summary>
    /// One paced Search-a-licious page. A required read reports its failure; an optional follow-up
    /// that cannot get a slot or an answer returns nothing, so it never costs the first page.
    /// </summary>
    private async Task<(List<FoodResult> Results,List<string?> Brands)> ReadHits(string query,ProviderGate gate,bool required,CancellationToken ct)
    {
        // The gate paces Open Food Facts, not the person typing: an early request waits for its slot.
        if(await gate.Reserve(SearchInterval,MaxSearchWait,ct) is not { } slot)
            return required?throw new FoodProviderException(ProviderId,FoodProviderFailure.Throttled):([],[]);
        try
        {
            if(slot.Wait>TimeSpan.Zero)await Task.Delay(slot.Wait,ct);
            using var response=await Send($"{SearchUrl}?page_size={SearchPageSize}&fields={SearchFields}&q={Uri.EscapeDataString(query)}",ct);
            if(response.StatusCode==HttpStatusCode.TooManyRequests)
            {
                // A shed answer is a real instruction to back off, not to resume the one-second pace.
                var until=DateTime.UtcNow.Add(BusyBackoff);
                await SearchGate.Hold(until);
                await pacing.SearchFollowUp.Hold(until);
                throw new FoodProviderException(ProviderId,FoodProviderFailure.Busy,BusyBackoff);
            }
            if(!response.IsSuccessStatusCode)throw new FoodProviderException(ProviderId,SearchFailure(response.StatusCode));
            var results=new List<FoodResult>();
            var brands=new List<string?>();
            using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if(json.RootElement.TryGetProperty("hits",out var hits)&&hits.ValueKind==JsonValueKind.Array)
                foreach(var hit in hits.EnumerateArray())
                {
                    brands.Add(OpenFoodFactsParser.Brand(hit));
                    if(OpenFoodFactsParser.ReadProduct(hit,null,"unverified") is {} result)results.Add(result);
                }
            return (results,brands);
        }
        catch(FoodProviderException failure) when(failure.Failure==FoodProviderFailure.Busy)
        {
            if(required)throw;
            return ([],[]);
        }
        catch(Exception error)
        {
            // Any other failure hands its slot back, or the retry the error message asks for is
            // answered by our own limit instead of reaching Open Food Facts.
            await gate.Return(slot);
            if(required||ct.IsCancellationRequested)throw;
            log?.LogWarning(error,"Open Food Facts brand follow-up search failed.");
            return ([],[]);
        }
    }

    /// <summary>Open Food Facts sheds search load under pressure; only a 429 means back off.</summary>
    public static FoodProviderFailure SearchFailure(HttpStatusCode status)
        =>status==HttpStatusCode.TooManyRequests?FoodProviderFailure.Busy:FoodProviderFailure.Unavailable;

    public async Task<FoodResult?> Barcode(string code,CancellationToken ct)
    {
        // A second package scanned straight after the first waits for its slot, as a search does;
        // only a queue deeper than one slot is refused. No slot is returned on failure: the request
        // reached a metered endpoint and counted against its allowance whatever it answered.
        if(await BarcodeGate.Reserve(BarcodeInterval,MaxBarcodeWait,ct) is not { } slot)
            throw new FoodProviderException(ProviderId,FoodProviderFailure.Throttled,BarcodeInterval);
        await WaitForSlot(BarcodeGate,slot,ct);
        return await ReadProduct(code,ct);
    }

    /// <summary>One product endpoint read; the caller has already been given its paced slot.</summary>
    private async Task<FoodResult?> ReadProduct(string code,CancellationToken ct)
    {
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
        // No per-product fallback here: the search is already inside the merge grace, so it only
        // makes the one bulk attempt and leaves the rest to the confirming read.
        foreach(var (code,hydrated) in await ReadProducts(codes,durable,false,ct))Apply(results,code,hydrated);
    }

    /// <summary>
    /// The confirming read a search could not finish in time (its paced slot, or Open Food Facts
    /// refusing the bulk read). Products already confirmed come from the durable cache without a
    /// call; if the bulk read fails again, the first few rows are read one by one from the product
    /// endpoint, the same one that answers when a row is opened.
    /// </summary>
    public async Task<IReadOnlyList<FoodResult>> VerifyBasis(IReadOnlyCollection<string> codes,PublicFoodCache durable,CancellationToken ct)
        =>[..(await ReadProducts(codes,durable,true,ct)).Values];

    /// <summary>
    /// Per-100 g products by code: the durable cache first, then one paced bulk read for the rest.
    /// A failed bulk read never fails the search; it is logged and remembered for a minute, and with
    /// <paramref name="fallback"/> the leading rows are confirmed through the product endpoint instead.
    /// </summary>
    private async Task<Dictionary<string,FoodResult>> ReadProducts(IReadOnlyCollection<string> codes,PublicFoodCache? durable,bool fallback,CancellationToken ct)
    {
        var found=new Dictionary<string,FoodResult>(StringComparer.Ordinal);
        if(codes.Count==0)return found;
        var missing=codes.ToHashSet(StringComparer.Ordinal);
        if(durable is not null)
        {
            foreach(var (code,hydrated) in await durable.Read(ProviderId,codes,ct))
            {
                missing.Remove(code);
                found[code]=hydrated;
            }
        }
        if(missing.Count==0)return found;
        // A bulk read that just failed is not repeated into another failure (and another wait for its
        // slot); the confirming read goes straight to the per-product endpoint instead.
        var bulkRead=!pacing.BulkRecentlyFailed&&await ReadBulk(missing,durable,found,ct);
        if(!bulkRead&&fallback)await ReadEach(codes.Where(missing.Contains).Take(FallbackReads),durable,found,ct);
        return found;
    }

    /// <summary>One paced bulk read for <paramref name="missing"/>; false when Open Food Facts gave no usable answer.</summary>
    private async Task<bool> ReadBulk(HashSet<string> missing,PublicFoodCache? durable,Dictionary<string,FoodResult> found,CancellationToken ct)
    {
        try
        {
            var slot=(await BatchProductGate.Reserve(BatchProductInterval,null,ct))!.Value;
            await WaitForSlot(BatchProductGate,slot,ct);
            using var response=await http.GetAsync($"{BatchProductUrl}?code={Uri.EscapeDataString(string.Join(',',missing))}&fields={Uri.EscapeDataString(ProductFields)}&page_size={missing.Count}",ct);
            if(!response.IsSuccessStatusCode)
            {
                await NoteBulkRefusal(response,missing.Count);
                return false;
            }
            using var json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if(!json.RootElement.TryGetProperty("products",out var products)||products.ValueKind!=JsonValueKind.Array)
            {
                pacing.NoteBulkFailure();
                log?.LogWarning("Open Food Facts bulk product read for {Count} codes returned no product list.",missing.Count);
                return false;
            }
            var read=new Dictionary<string,FoodResult>(StringComparer.Ordinal);
            foreach(var product in products.EnumerateArray())
            {
                var code=OpenFoodFactsParser.Code(product);
                if(code is {Length:>0}&&OpenFoodFactsParser.ReadProduct(product,code,"per100g") is {} hydrated)read[code]=hydrated;
            }
            foreach(var (code,hydrated) in read)found[code]=hydrated;
            await StoreConfirmed(durable,read.Values,ct);
            pacing.NoteBulkSuccess();
            return true;
        }
        catch(OperationCanceledException) when(ct.IsCancellationRequested){throw;}
        catch(Exception error)
        {
            // Serving hydration improves the search list but must not make free-text search fail.
            pacing.NoteBulkFailure();
            log?.LogWarning(error,"Open Food Facts bulk product read for {Count} codes failed before an answer.",missing.Count);
            return false;
        }
    }

    /// <summary>A 429 carries the pause Open Food Facts wants; the gate keeps later bulk reads behind it.</summary>
    private async Task NoteBulkRefusal(HttpResponseMessage response,int count)
    {
        pacing.NoteBulkFailure();
        TimeSpan? retryAfter=null;
        if(response.StatusCode==HttpStatusCode.TooManyRequests)
        {
            retryAfter=response.Headers.RetryAfter?.Delta??BusyBackoff;
            await BatchProductGate.Hold(DateTime.UtcNow.Add(retryAfter.Value));
        }
        log?.LogWarning("Open Food Facts bulk product read for {Count} codes was refused: HTTP {Status}, retry after {RetryAfter}.",count,(int)response.StatusCode,retryAfter);
    }

    /// <summary>
    /// Confirms rows one by one when the bulk read failed. It stops at the first failure: a refusal
    /// means the endpoint is busy, and a full list of single reads would exhaust its allowance.
    /// These reads share the product endpoint's slots with a person opening a row, so they only
    /// take a free slot and never queue ahead of that person. Each row is stored as soon as it is
    /// confirmed, and the rows confirmed before the deadline are still returned.
    /// </summary>
    private async Task ReadEach(IEnumerable<string> codes,PublicFoodCache? durable,Dictionary<string,FoodResult> found,CancellationToken ct)
    {
        var attempted=0;
        var confirmed=0;
        try
        {
            foreach(var code in codes)
            {
                await BarcodeGate.ReserveWhenIdle(BarcodeInterval,ct);
                attempted++;
                try
                {
                    if(await ReadProduct(code,ct) is not {} product)continue;
                    found[code]=product;
                    confirmed++;
                    await StoreConfirmed(durable,[product],ct);
                }
                catch(FoodProviderException failure)
                {
                    log?.LogWarning("Open Food Facts product read for {Code} failed: {Failure}.",code,failure.Failure);
                    if(failure.Failure!=FoodProviderFailure.Incomplete)break;
                }
            }
        }
        catch(OperationCanceledException) { /* The deadline ends the fallback; what it confirmed stands. */ }
        log?.LogInformation("Open Food Facts per-product fallback confirmed {Confirmed} of {Attempted} rows.",confirmed,attempted);
    }

    private async Task StoreConfirmed(PublicFoodCache? durable,IEnumerable<FoodResult> products,CancellationToken ct)
    {
        var rows=products.ToArray();
        if(durable is not null&&rows.Length>0)
            await durable.Store(ProviderId,rows,DateTime.UtcNow.Add(DurableLifetime!.Value),ct);
    }

    /// <summary>Waits for a reserved slot; a request cancelled before it was sent hands the slot back.</summary>
    private static async Task WaitForSlot(ProviderGate gate,ProviderGate.Slot slot,CancellationToken ct)
    {
        try { if(slot.Wait>TimeSpan.Zero)await Task.Delay(slot.Wait,ct); }
        catch(OperationCanceledException)
        {
            await gate.Return(slot);
            throw;
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
