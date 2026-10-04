using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace Nutrition.Api.Services.FoodLookup;

public sealed class FatSecretOptions
{
    public string ClientId { get; init; }="";
    public string ClientSecret { get; init; }="";
    /// <summary>Premier localization (for example "MY"); empty on Basic, which serves the US dataset.</summary>
    public string? Region { get; init; }
    /// <summary>Barcode lookup is a Premier method; enable only when the key's edition includes it.</summary>
    public bool Barcode { get; init; }
    /// <summary>Basic allows 5,000 calls a day; the provider stops before the platform refuses.</summary>
    public int DailyLimit { get; init; }=5000;

    public static FatSecretOptions? FromConfiguration(IConfiguration config)
    {
        var section=config.GetSection("FoodProviders:FatSecret");
        var id=section["ClientId"]?.Trim();
        var secret=section["ClientSecret"]?.Trim();
        if(string.IsNullOrEmpty(id)||string.IsNullOrEmpty(secret))return null;
        return new FatSecretOptions
        {
            ClientId=id,ClientSecret=secret,
            Region=section["Region"]?.Trim() is {Length:>0} region?region:null,
            Barcode=section.GetValue("Barcode",false),
            DailyLimit=section.GetValue("DailyLimit",5000),
        };
    }
}

/// <summary>
/// fatsecret Platform API: broad generic, branded and restaurant search. Search returns summaries,
/// so each hit is completed with food.get for its gram servings. Terms allow caching for at most
/// 24 hours, so nothing from here is written to the durable product cache.
/// </summary>
public sealed class FatSecretProvider(HttpClient http,FatSecretOptions options):IFoodProvider
{
    public const string ProviderId="fatsecret";
    public const string Attribution="fatsecret";
    private const string TokenUrl="https://oauth.fatsecret.com/connect/token";
    private const string SearchUrl="https://platform.fatsecret.com/rest/foods/search/v1";
    private const string FoodUrl="https://platform.fatsecret.com/rest/food/v4";
    private const string BarcodeUrl="https://platform.fatsecret.com/rest/food/barcode/find-by-id/v1";
    private const int MaxResults=8;
    private static readonly ConcurrentDictionary<string,(string Token,DateTime Expires)> Tokens=new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string,DailyQuota> Quotas=new(StringComparer.Ordinal);
    // Search runs as the person types, so "bana" and "banana" return mostly the same foods. Each
    // detail costs one call of the daily allowance; reusing it for a few hours (well inside the
    // 24-hour limit in fatsecret's terms) makes a refined query cost roughly one call, not nine.
    // A private cache keeps these entries from crowding the app's shared, size-limited one.
    private static readonly MemoryCache Details=new(new MemoryCacheOptions{SizeLimit=2000});
    private static readonly TimeSpan DetailLifetime=TimeSpan.FromHours(6);

    public string Id=>ProviderId;
    public string Name=>"fatsecret";
    public FoodCapability Capabilities=>options.Barcode?FoodCapability.Search|FoodCapability.Barcode:FoodCapability.Search;

    public async Task<IReadOnlyList<FoodResult>> Search(string query,PublicFoodCache? durable,CancellationToken ct)
    {
        using var json=await Get($"{SearchUrl}?search_expression={Uri.EscapeDataString(query)}&max_results={MaxResults}&format=json{Locale()}",ct);
        var hits=FatSecretParser.SearchHits(json.RootElement);
        // Details are best-effort: a hit whose detail fails still counts when its summary is per 100 g.
        var details=await Task.WhenAll(hits.Select(hit=>DetailOrSummary(hit,ct)));
        return details.OfType<FoodResult>().ToArray();
    }

    public async Task<FoodResult?> Barcode(string code,CancellationToken ct)
    {
        if(!options.Barcode)return null;
        // fatsecret matches GTIN-13: UPC-A and EAN-8 are zero-filled on the left.
        var gtin13=code.Length<13?code.PadLeft(13,'0'):code.Length==14&&code[0]=='0'?code[1..]:code;
        using var json=await Get($"{BarcodeUrl}?barcode={gtin13}&format=json",ct);
        if(!json.RootElement.TryGetProperty("food_id",out var id)||FoodResults.Text(id,"value") is not { } foodId||foodId=="0")return null;
        var hit=new FatSecretParser.SearchHit(foodId,"",null,false,null);
        using var detail=await Get($"{FoodUrl}?food_id={foodId}&format=json{Locale()}",ct);
        if(!detail.RootElement.TryGetProperty("food",out var food))return null;
        hit=hit with { Name=FoodResults.Text(food,"food_name")??"Packaged food",Brand=FoodResults.Text(food,"brand_name") };
        return FatSecretParser.Detail(detail.RootElement,hit,code)
            ??throw new FoodProviderException(ProviderId,FoodProviderFailure.Incomplete);
    }

    private async Task<FoodResult?> DetailOrSummary(FatSecretParser.SearchHit hit,CancellationToken ct)
    {
        var key=$"{options.ClientId}|{Locale()}|{hit.Id}";
        if(Details.TryGetValue<FoodResult>(key,out var cached))return cached;
        try
        {
            using var json=await Get($"{FoodUrl}?food_id={Uri.EscapeDataString(hit.Id)}&format=json{Locale()}",ct);
            if(FatSecretParser.Detail(json.RootElement,hit) is { } detailed)
            {
                Details.Set(key,detailed,new MemoryCacheEntryOptions{Size=1,AbsoluteExpirationRelativeToNow=DetailLifetime});
                return detailed;
            }
        }
        catch(FoodProviderException failure) when(failure.Failure is not FoodProviderFailure.Busy) { }
        return FatSecretParser.FromDescription(hit);
    }

    private string Locale()
        =>options.Region is { } region
            ?"&region="+Uri.EscapeDataString(region)+"&language=en"
            :"";

    private async Task<JsonDocument> Get(string url,CancellationToken ct)
    {
        for(var attempt=0;;attempt++)
        {
            if(!Quotas.GetOrAdd(options.ClientId,_=>new DailyQuota(options.DailyLimit)).TryTake())
                throw new FoodProviderException(ProviderId,FoodProviderFailure.Busy,DailyQuota.UntilReset());
            using var request=new HttpRequestMessage(HttpMethod.Get,url);
            request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",await Token(ct));
            using var response=await Send(request,ct);
            var json=await Read(response,ct);
            var error=ErrorCode(json.RootElement);
            // Codes 13 and 14 (and a bare 401) mean the cached token is no longer accepted.
            if((error is 13 or 14||response.StatusCode==HttpStatusCode.Unauthorized)&&attempt==0)
            {
                json.Dispose();
                Tokens.TryRemove(options.ClientId,out _);
                continue;
            }
            if(error is not null||!response.IsSuccessStatusCode)
            {
                json.Dispose();
                throw new FoodProviderException(ProviderId,error==12||response.StatusCode==HttpStatusCode.TooManyRequests?FoodProviderFailure.Busy:FoodProviderFailure.Unavailable);
            }
            return json;
        }
    }

    private async Task<string> Token(CancellationToken ct)
    {
        if(Tokens.TryGetValue(options.ClientId,out var cached)&&cached.Expires>DateTime.UtcNow)return cached.Token;
        using var request=new HttpRequestMessage(HttpMethod.Post,TokenUrl)
        {
            Content=new FormUrlEncodedContent(new Dictionary<string,string>
            {
                ["grant_type"]="client_credentials",
                ["scope"]=options.Barcode?"basic barcode":"basic",
            }),
        };
        request.Headers.Authorization=new AuthenticationHeaderValue("Basic",Convert.ToBase64String(Encoding.UTF8.GetBytes(options.ClientId+":"+options.ClientSecret)));
        using var response=await Send(request,ct);
        if(!response.IsSuccessStatusCode)throw new FoodProviderException(ProviderId,FoodProviderFailure.Unavailable);
        using var json=await Read(response,ct);
        if(FoodResults.Text(json.RootElement,"access_token") is not { } token)throw new FoodProviderException(ProviderId,FoodProviderFailure.InvalidData);
        // Renew five minutes early so a token never expires between this check and the call.
        var lifetime=FoodResults.Number(json.RootElement,"expires_in") is { } seconds?TimeSpan.FromSeconds(seconds):TimeSpan.FromHours(1);
        Tokens[options.ClientId]=(token,DateTime.UtcNow.Add(lifetime).AddMinutes(-5));
        return token;
    }

    private static int? ErrorCode(JsonElement root)
        =>root.ValueKind==JsonValueKind.Object&&root.TryGetProperty("error",out var error)&&error.ValueKind==JsonValueKind.Object
            ?(int?)FoodResults.Number(error,"code")??0
            :null;

    private async Task<HttpResponseMessage> Send(HttpRequestMessage request,CancellationToken ct)
    {
        try { return await http.SendAsync(request,ct); }
        catch(HttpRequestException) { throw new FoodProviderException(ProviderId,FoodProviderFailure.Unreachable); }
        catch(TaskCanceledException) when(!ct.IsCancellationRequested) { throw new FoodProviderException(ProviderId,FoodProviderFailure.TimedOut); }
    }

    private static async Task<JsonDocument> Read(HttpResponseMessage response,CancellationToken ct)
    {
        try { return JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct)); }
        catch(JsonException) { throw new FoodProviderException(ProviderId,FoodProviderFailure.InvalidData); }
        catch(HttpRequestException) { throw new FoodProviderException(ProviderId,FoodProviderFailure.Unreachable); }
        catch(TaskCanceledException) when(!ct.IsCancellationRequested) { throw new FoodProviderException(ProviderId,FoodProviderFailure.TimedOut); }
    }
}
