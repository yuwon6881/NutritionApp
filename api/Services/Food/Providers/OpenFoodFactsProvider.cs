using System.Net;
using System.Text.Json;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Open Food Facts barcode lookup through the live product API: the best open source for Malaysian
/// barcodes, and current where the bundled export (<see cref="OpenFoodFactsBundledProvider"/>, which
/// answers free-text search) is not. The product endpoint is rate limited per egress address, so
/// reads are paced.
/// </summary>
public sealed class OpenFoodFactsProvider(HttpClient http,OpenFoodFactsPacing? gates=null):IFoodProvider
{
    public const string ProviderId="off";
    private const string ProductUrl="https://world.openfoodfacts.org/api/v2/product/";
    private static readonly TimeSpan BarcodeInterval=TimeSpan.FromSeconds(4.1);
    private static readonly TimeSpan MaxBarcodeWait=TimeSpan.FromSeconds(5);
    private const string ProductFields="code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,quantity,product_quantity_unit";
    private readonly OpenFoodFactsPacing pacing=gates??OpenFoodFactsPacing.Shared;
    private ProviderGate BarcodeGate=>pacing.Barcode;

    public string Id=>ProviderId;
    public string Name=>"Open Food Facts";
    public FoodCapability Capabilities=>FoodCapability.Barcode;
    public TimeSpan? DurableLifetime=>TimeSpan.FromDays(1);

    public Task<IReadOnlyList<FoodResult>> Search(string query,PublicFoodCache? durable,CancellationToken ct)
        =>Task.FromResult<IReadOnlyList<FoodResult>>([]);

    public async Task<FoodResult?> Barcode(string code,CancellationToken ct)
    {
        // A second package scanned straight after the first waits for its slot;
        // only a queue deeper than one slot is refused. No slot is returned on failure: the request
        // reached a metered endpoint and counted against its allowance whatever it answered.
        if(await BarcodeGate.Reserve(BarcodeInterval,MaxBarcodeWait,ct) is not { } slot)
            throw new FoodProviderException(ProviderId,FoodProviderFailure.Throttled,BarcodeInterval);
        await WaitForSlot(BarcodeGate,slot,ct);
        using var response=await Send($"{ProductUrl}{code}?fields={ProductFields}",ct);
        if(response.StatusCode==HttpStatusCode.NotFound)return null;
        if(response.StatusCode==HttpStatusCode.TooManyRequests)throw new FoodProviderException(ProviderId,FoodProviderFailure.Busy);
        if(!response.IsSuccessStatusCode)throw new FoodProviderException(ProviderId,FoodProviderFailure.Unavailable);
        using var json=await ReadJson(response,ct);
        if(!json.RootElement.TryGetProperty("product",out var product))return null;
        if(OpenFoodFactsParser.Calories(product) is null)throw new FoodProviderException(ProviderId,FoodProviderFailure.Incomplete);
        return OpenFoodFactsParser.ReadProduct(product,code);
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
