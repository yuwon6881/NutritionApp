using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nutrition.Api.Services;
using Nutrition.Api.Services.FoodLookup;
using Xunit;

namespace Nutrition.Tests;

public sealed class FoodProviderRegistrationTests
{
    private static (FoodCatalog Catalog,IReadOnlyList<string> Skipped) Build(Dictionary<string,string?> settings,bool development=false)
    {
        var config=new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var services=new ServiceCollection();
        services.AddMemoryCache(options=>options.SizeLimit=256);
        services.AddTransient<ExternalCallMetricsHandler>();
        var skipped=services.AddFoodProviders(config,development);
        return (services.BuildServiceProvider().GetRequiredService<FoodCatalog>(),skipped);
    }

    [Fact]
    public void Providers_without_credentials_are_skipped_and_reported()
    {
        var (catalog,skipped)=Build([]);

        Assert.Equal(["usda","off"],catalog.SearchProviders.Select(provider=>provider.Id));
        Assert.Equal(["off"],catalog.BarcodeProviders.Select(provider=>provider.Id));
        Assert.Contains(skipped,reason=>reason.StartsWith("fatsecret:",StringComparison.Ordinal));
        Assert.Contains(skipped,reason=>reason.StartsWith("usda-branded:",StringComparison.Ordinal));
    }

    [Fact]
    public void Configured_providers_join_in_the_configured_order()
    {
        var (catalog,skipped)=Build(new()
        {
            ["FoodProviders:FatSecret:ClientId"]=" id ",
            ["FoodProviders:FatSecret:ClientSecret"]="secret",
            ["FoodProviders:FatSecret:Barcode"]="true",
            ["FoodProviders:Usda:ApiKey"]="key",
            ["FoodProviders:Search:0"]="off",
            ["FoodProviders:Search:1"]="fatsecret",
            ["FoodProviders:Search:2"]="usda",
        });

        Assert.Empty(skipped);
        Assert.Equal(["off","fatsecret","usda"],catalog.SearchProviders.Select(provider=>provider.Id));
        Assert.Equal(["off","fatsecret","usda-branded"],catalog.BarcodeProviders.Select(provider=>provider.Id));
    }

    [Fact]
    public void Development_falls_back_to_the_shared_usda_demo_key()
    {
        var (catalog,_)=Build([],development:true);

        Assert.Contains(catalog.BarcodeProviders,provider=>provider.Id=="usda-branded");
    }
}
