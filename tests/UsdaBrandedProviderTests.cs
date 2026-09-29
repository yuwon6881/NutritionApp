using System.Net;
using System.Text;
using Nutrition.Api.Services.FoodLookup;
using Xunit;

namespace Nutrition.Tests;

public sealed class UsdaBrandedProviderTests
{
    // Trimmed from an FDC /foods/search response for Branded foods. Branded foodNutrients are
    // already per 100 g (or per 100 ml when the serving is a volume); the label values are not used.
    private const string CornFlakes="""
        {"totalHits":2,"foods":[
          {"fdcId":1,"description":"CORN FLAKES CEREAL","brandName":"KELLOGG'S","brandOwner":"Kellogg Company US","gtinUpc":"038000000966","dataType":"Branded",
           "servingSize":28.0,"servingSizeUnit":"g","householdServingFullText":"1 cup",
           "foodNutrients":[{"nutrientNumber":"208","unitName":"KCAL","value":357},{"nutrientNumber":"203","unitName":"G","value":7.14},{"nutrientNumber":"204","unitName":"G","value":0},{"nutrientNumber":"205","unitName":"G","value":85.7}]},
          {"fdcId":2,"description":"OTHER CEREAL","gtinUpc":"038000000967","dataType":"Branded",
           "foodNutrients":[{"nutrientNumber":"208","unitName":"KCAL","value":380}]}
        ]}
        """;

    private sealed class Api(HttpStatusCode status,string body):HttpMessageHandler
    {
        public List<Uri> Requests { get; }=[];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {
            Requests.Add(request.RequestUri!);
            return Task.FromResult(new HttpResponseMessage(status){Content=new StringContent(body,Encoding.UTF8,"application/json")});
        }
    }

    private static UsdaBrandedProvider Provider(Api api)=>new(new HttpClient(api),new UsdaBrandedOptions("test-key"));

    [Fact]
    public async Task An_ean13_barcode_is_searched_as_its_upc_and_verified_against_gtinUpc()
    {
        var api=new Api(HttpStatusCode.OK,CornFlakes);

        var result=await Provider(api).Barcode("0038000000966",default);

        Assert.Contains("query=038000000966",Assert.Single(api.Requests).Query);
        Assert.Equal("Corn Flakes Cereal · Kellogg's",result!.Name);
        Assert.Equal(357,result.Calories);
        Assert.Equal(0,result.Fat);
        Assert.Null(result.Fiber);
        Assert.Equal("0038000000966",result.Code);
        Assert.Equal("per100g",result.Basis);
        Assert.Equal("USDA FoodData Central / 0038000000966",result.Source);
        Assert.Equal([new FoodPortion("1 cup",28)],result.Portions);
    }

    [Fact]
    public async Task A_search_hit_with_a_different_barcode_is_not_a_match()
    {
        var result=await Provider(new Api(HttpStatusCode.OK,CornFlakes)).Barcode("0038000000999",default);

        Assert.Null(result);
    }

    [Fact]
    public async Task A_volume_serving_keeps_its_nutrients_but_not_a_gram_basis()
    {
        var juice=CornFlakes.Replace("\"servingSizeUnit\":\"g\"","\"servingSizeUnit\":\"ml\"",StringComparison.Ordinal);

        var result=await Provider(new Api(HttpStatusCode.OK,juice)).Barcode("038000000966",default);

        Assert.Equal("unverified",result!.Basis);
        Assert.Empty(result.Portions!);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests,FoodProviderFailure.Busy)]
    [InlineData(HttpStatusCode.Forbidden,FoodProviderFailure.Unavailable)]
    public async Task Api_refusals_become_provider_failures(HttpStatusCode status,FoodProviderFailure expected)
    {
        var failure=await Assert.ThrowsAsync<FoodProviderException>(()=>Provider(new Api(status,"{}")).Barcode("038000000966",default));

        Assert.Equal(expected,failure.Failure);
    }

    [Fact]
    public void The_api_key_is_required_outside_development()
    {
        var config=new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build();

        Assert.Null(UsdaBrandedOptions.FromConfiguration(config,development:false));
        Assert.Equal("DEMO_KEY",UsdaBrandedOptions.FromConfiguration(config,development:true)!.ApiKey);
    }
}
