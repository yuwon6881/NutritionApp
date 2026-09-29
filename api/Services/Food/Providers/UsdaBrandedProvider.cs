using System.Globalization;
using System.Net;
using System.Text.Json;

namespace Nutrition.Api.Services.FoodLookup;

public sealed record UsdaBrandedOptions(string ApiKey)
{
    /// <summary>
    /// The api.data.gov key. DEMO_KEY is shared and heavily limited, so it is only a development
    /// fallback; production without a key leaves this provider out.
    /// </summary>
    public static UsdaBrandedOptions? FromConfiguration(IConfiguration config,bool development)
    {
        var key=config["FoodProviders:Usda:ApiKey"]?.Trim();
        if(!string.IsNullOrEmpty(key))return new UsdaBrandedOptions(key);
        return development?new UsdaBrandedOptions("DEMO_KEY"):null;
    }
}

/// <summary>
/// USDA FoodData Central branded foods (2M+ US products with a gtinUpc), used only as the last
/// barcode fallback. The search index is matched on the UPC-A form and every hit is verified
/// against its own gtinUpc, because full-text search can return near misses.
/// </summary>
public sealed class UsdaBrandedProvider(HttpClient http,UsdaBrandedOptions options):IFoodProvider
{
    public const string ProviderId="usda-branded";
    private const string SearchUrl="https://api.nal.usda.gov/fdc/v1/foods/search";

    public string Id=>ProviderId;
    public string Name=>"USDA FoodData Central";
    public FoodCapability Capabilities=>FoodCapability.Barcode;
    // Public domain data; the day matches the other barcode caches.
    public TimeSpan? DurableLifetime=>TimeSpan.FromDays(1);

    public Task<IReadOnlyList<FoodResult>> Search(string query,PublicFoodCache? durable,CancellationToken ct)
        =>Task.FromResult<IReadOnlyList<FoodResult>>([]);

    public async Task<FoodResult?> Barcode(string code,CancellationToken ct)
    {
        var wanted=FoodResultMerger.NormalizeGtin(code);
        if(wanted is null)return null;
        // FDC indexes most US products under the 12-digit UPC-A, which is the GTIN without its padding.
        var upc=wanted.Length<=12?wanted.PadLeft(12,'0'):wanted;
        var url=$"{SearchUrl}?api_key={Uri.EscapeDataString(options.ApiKey)}&query={upc}&dataType=Branded&pageSize=5";
        HttpResponseMessage response;
        try { response=await http.GetAsync(url,ct); }
        catch(HttpRequestException) { throw new FoodProviderException(ProviderId,FoodProviderFailure.Unreachable); }
        catch(TaskCanceledException) when(!ct.IsCancellationRequested) { throw new FoodProviderException(ProviderId,FoodProviderFailure.TimedOut); }
        using(response)
        {
            if(response.StatusCode==HttpStatusCode.TooManyRequests)throw new FoodProviderException(ProviderId,FoodProviderFailure.Busy);
            if(!response.IsSuccessStatusCode)throw new FoodProviderException(ProviderId,FoodProviderFailure.Unavailable);
            JsonDocument json;
            try { json=JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct)); }
            catch(JsonException) { throw new FoodProviderException(ProviderId,FoodProviderFailure.InvalidData); }
            using(json)
            {
                if(!json.RootElement.TryGetProperty("foods",out var foods)||foods.ValueKind!=JsonValueKind.Array)return null;
                foreach(var food in foods.EnumerateArray())
                    if(FoodResultMerger.NormalizeGtin(FoodResults.Text(food,"gtinUpc"))==wanted)
                        return Read(food,code)??throw new FoodProviderException(ProviderId,FoodProviderFailure.Incomplete);
                return null;
            }
        }
    }

    public static FoodResult? Read(JsonElement food,string code)
    {
        var nutrients=new Dictionary<string,double>(StringComparer.Ordinal);
        if(food.TryGetProperty("foodNutrients",out var list)&&list.ValueKind==JsonValueKind.Array)
            foreach(var nutrient in list.EnumerateArray())
                if(FoodResults.Text(nutrient,"nutrientNumber") is { } number&&FoodResults.Number(nutrient,"value") is { } value&&value>=0)
                    nutrients.TryAdd(number,value);
        double? Get(string number)=>nutrients.TryGetValue(number,out var value)?value:null;
        if(Get("208") is not { } calories)return null;
        // Branded nutrients are per 100 of the serving unit. For a volume serving that is 100 ml,
        // which is not 100 g, so the basis is left unverified and no gram portion is offered.
        var unit=FoodResults.Text(food,"servingSizeUnit")?.ToLowerInvariant();
        var grams=unit is "g" or "grm";
        var portions=grams&&FoodResults.Number(food,"servingSize") is { } size
            ?FoodResults.LimitPortions([new FoodPortion(FoodResults.PortionLabel(FoodResults.Text(food,"householdServingFullText")??"")??"serving",size)])
            :[];
        var name=Readable(FoodResults.Text(food,"description")??"Packaged food");
        var brand=FoodResults.Text(food,"brandName")??FoodResults.Text(food,"brandOwner");
        return new FoodResult(FoodResults.Label(name,brand is null?null:Readable(brand)),calories,Get("203"),Get("204"),Get("205"),Get("291"),
            "USDA FoodData Central / "+code,100,portions,code,FoodResults.ServingCalories(calories,portions),grams?"per100g":"unverified");
    }

    /// <summary>Branded descriptions are stored in capitals; title case reads as a product name.</summary>
    private static string Readable(string text)
        =>text.Any(char.IsLower)?text:CultureInfo.InvariantCulture.TextInfo.ToTitleCase(text.ToLowerInvariant());
}
