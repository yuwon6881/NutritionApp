using System.Net;
using System.Text;
using Nutrition.Api.Services.FoodLookup;
using Xunit;

namespace Nutrition.Tests;

public sealed class FatSecretProviderTests
{
    // Shapes trimmed from the fatsecret Platform API documentation examples. A single match
    // arrives as an object rather than a one-element array, in both "food" and "serving".
    private const string SearchResponse="""
        {"foods":{"food":[
          {"food_id":"5388","food_name":"Banana","food_type":"Generic","food_description":"Per 100g - Calories: 89kcal | Fat: 0.33g | Carbs: 22.84g | Protein: 1.09g"},
          {"food_id":"41963","food_name":"Cheeseburger","brand_name":"McDonald's","food_type":"Brand","food_description":"Per 1 serving - Calories: 300kcal | Fat: 13.00g | Carbs: 32.00g | Protein: 15.00g"}
        ],"max_results":"10","page_number":"0","total_results":"2"}}
        """;
    private const string BananaDetail="""
        {"food":{"food_id":"5388","food_name":"Banana","food_type":"Generic","servings":{"serving":[
          {"serving_description":"1 medium (7\" to 7-7/8\" long)","metric_serving_amount":"118.000","metric_serving_unit":"g","calories":"105","protein":"1.29","fat":"0.39","carbohydrate":"26.95","fiber":"3.1"},
          {"serving_description":"100 g","metric_serving_amount":"100.000","metric_serving_unit":"g","calories":"89","protein":"1.09","fat":"0.33","carbohydrate":"22.84","fiber":"2.6"},
          {"serving_description":"1 cup","metric_serving_amount":"250.000","metric_serving_unit":"ml","calories":"200"}
        ]}}}
        """;
    private const string BurgerDetail="""
        {"food":{"food_id":"41963","food_name":"Cheeseburger","brand_name":"McDonald's","food_type":"Brand","servings":{"serving":
          {"serving_description":"1 burger","metric_serving_amount":"119.000","metric_serving_unit":"g","calories":"300","protein":"15.00","fat":"13.00","carbohydrate":"32.00"}
        }}}
        """;

    private sealed class Api(Func<HttpRequestMessage,(HttpStatusCode Status,string Body)> respond):HttpMessageHandler
    {
        public List<string> Paths { get; }=[];
        public int TokenRequests=>Paths.Count(path=>path.EndsWith("/connect/token",StringComparison.Ordinal));
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {
            Paths.Add(request.RequestUri!.AbsolutePath);
            var (status,body)=request.RequestUri.AbsolutePath.EndsWith("/connect/token",StringComparison.Ordinal)
                ?(HttpStatusCode.OK,"""{"access_token":"token-1","token_type":"Bearer","expires_in":86400}""")
                :respond(request);
            return Task.FromResult(new HttpResponseMessage(status){Content=new StringContent(body,Encoding.UTF8,"application/json")});
        }
    }

    private static (HttpStatusCode,string) Catalogue(HttpRequestMessage request)
    {
        var query=request.RequestUri!.Query;
        if(request.RequestUri.AbsolutePath.EndsWith("/foods/search/v1",StringComparison.Ordinal))return (HttpStatusCode.OK,SearchResponse);
        if(query.Contains("food_id=5388",StringComparison.Ordinal))return (HttpStatusCode.OK,BananaDetail);
        if(query.Contains("food_id=41963",StringComparison.Ordinal))return (HttpStatusCode.OK,BurgerDetail);
        return (HttpStatusCode.NotFound,"{}");
    }

    // Each test gets its own client id: the token cache is process-wide by design.
    private static FatSecretProvider Provider(Api api,bool barcode=false,int dailyLimit=5000)
        =>new(new HttpClient(api),new FatSecretOptions{ClientId="client-"+Guid.NewGuid(),ClientSecret="secret",Barcode=barcode,DailyLimit=dailyLimit});

    [Fact]
    public async Task Search_converts_gram_servings_to_per_100g_and_keeps_portions()
    {
        var results=await Provider(new Api(Catalogue)).Search("banana",null,default);

        var banana=results[0];
        Assert.Equal("Banana",banana.Name);
        Assert.True(banana.IsGeneric);
        Assert.Equal(89,banana.Calories);
        Assert.Equal(2.6,banana.Fiber);
        Assert.Equal("per100g",banana.Basis);
        Assert.Equal(FatSecretProvider.Attribution,banana.Source);
        Assert.Equal([new FoodPortion("1 medium",118)],banana.Portions);

        var burger=results[1];
        Assert.Equal("Cheeseburger · McDonald's",burger.Name);
        Assert.False(burger.IsGeneric);
        Assert.Equal(300*100/119.0,burger.Calories,6);
        Assert.Equal(15*100/119.0,burger.Protein!.Value,6);
        Assert.Null(burger.Fiber);
        Assert.Equal([new FoodPortion("1 burger",119)],burger.Portions);
    }

    [Fact]
    public async Task The_access_token_is_requested_once_and_reused()
    {
        var api=new Api(Catalogue);
        var provider=Provider(api);

        await provider.Search("banana",null,default);
        await provider.Search("burger",null,default);

        Assert.Equal(1,api.TokenRequests);
    }

    [Fact]
    public async Task Typing_a_longer_query_reuses_food_details_already_fetched()
    {
        var api=new Api(Catalogue);
        var provider=Provider(api);

        await provider.Search("bana",null,default);
        await provider.Search("banana",null,default);

        // Two searches, one detail call per distinct food: the second search costs one call, not three.
        Assert.Equal(2,api.Paths.Count(path=>path.EndsWith("/foods/search/v1",StringComparison.Ordinal)));
        Assert.Equal(2,api.Paths.Count(path=>path.EndsWith("/food/v4",StringComparison.Ordinal)));
    }

    [Fact]
    public async Task A_rejected_token_is_refreshed_once()
    {
        var rejected=false;
        var api=new Api(request=>
        {
            if(!rejected&&request.RequestUri!.AbsolutePath.EndsWith("/foods/search/v1",StringComparison.Ordinal))
            {
                rejected=true;
                return (HttpStatusCode.OK,"""{"error":{"code":14,"message":"Invalid token"}}""");
            }
            return Catalogue(request);
        });

        var results=await Provider(api).Search("banana",null,default);

        Assert.Equal(2,results.Count);
        Assert.Equal(2,api.TokenRequests);
    }

    [Fact]
    public async Task A_result_without_a_gram_serving_uses_only_a_per_100g_description()
    {
        var api=new Api(request=>request.RequestUri!.AbsolutePath.EndsWith("/foods/search/v1",StringComparison.Ordinal)
            ?(HttpStatusCode.OK,SearchResponse)
            :(HttpStatusCode.InternalServerError,"{}"));

        var banana=Assert.Single(await Provider(api).Search("banana",null,default));

        Assert.Equal(89,banana.Calories);
        Assert.Equal(1.09,banana.Protein);
        Assert.Null(banana.Fiber);
        Assert.Empty(banana.Portions!);
    }

    [Theory]
    [InlineData(21,FoodProviderFailure.Unavailable)]
    [InlineData(12,FoodProviderFailure.Busy)]
    public async Task Platform_errors_become_provider_failures(int code,FoodProviderFailure expected)
    {
        var api=new Api(_=>(HttpStatusCode.OK,$$$"""{"error":{"code":{{{code}}},"message":"refused"}}"""));

        var failure=await Assert.ThrowsAsync<FoodProviderException>(()=>Provider(api).Search("banana",null,default));

        Assert.Equal(expected,failure.Failure);
    }

    [Fact]
    public async Task An_exhausted_daily_allowance_is_busy_without_calling_the_api()
    {
        var api=new Api(Catalogue);
        var provider=Provider(api,dailyLimit:0);

        var failure=await Assert.ThrowsAsync<FoodProviderException>(()=>provider.Search("banana",null,default));

        Assert.Equal(FoodProviderFailure.Busy,failure.Failure);
        Assert.Empty(api.Paths);
    }

    [Fact]
    public async Task Barcode_is_off_unless_the_edition_allows_it()
    {
        Assert.Equal(FoodCapability.Search,Provider(new Api(Catalogue)).Capabilities);

        var api=new Api(request=>request.RequestUri!.AbsolutePath.EndsWith("/food/barcode/find-by-id/v1",StringComparison.Ordinal)
            ?(HttpStatusCode.OK,request.RequestUri.Query.Contains("barcode=0012345678905",StringComparison.Ordinal)?"""{"food_id":{"value":"41963"}}""":"""{"food_id":{"value":"0"}}""")
            :Catalogue(request));
        var provider=Provider(api,barcode:true);

        var found=await provider.Barcode("012345678905",default);
        var missing=await provider.Barcode("9556001000000",default);

        Assert.Equal(FoodCapability.Search|FoodCapability.Barcode,provider.Capabilities);
        Assert.Equal("012345678905",found!.Code);
        Assert.Equal("Cheeseburger · McDonald's",found.Name);
        Assert.Null(missing);
    }
}
