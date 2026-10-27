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

        Assert.Equal(["usda","off-bundled"],catalog.SearchProviders.Select(provider=>provider.Id));
        Assert.Equal(["off"],catalog.BarcodeProviders.Select(provider=>provider.Id));
        Assert.Equal(["usda-branded: FoodProviders:Usda:ApiKey is not configured."],skipped);
    }

    [Fact]
    public void Configured_providers_join_in_the_configured_order()
    {
        var (catalog,skipped)=Build(new()
        {
            ["FoodProviders:Usda:ApiKey"]="key",
            ["FoodProviders:Search:0"]="off-bundled",
            ["FoodProviders:Search:1"]="usda",
        });

        Assert.Empty(skipped);
        Assert.Equal(["off-bundled","usda"],catalog.SearchProviders.Select(provider=>provider.Id));
        Assert.Equal(["off","usda-branded"],catalog.BarcodeProviders.Select(provider=>provider.Id));
    }

    /// Live Open Food Facts answers barcodes only; free text comes from the bundled export. An older
    /// configuration that still lists it for search runs without it rather than failing startup.
    [Fact]
    public void Live_open_food_facts_in_an_old_search_order_is_skipped()
    {
        var (catalog,_)=Build(new()
        {
            ["FoodProviders:Search:0"]="usda",
            ["FoodProviders:Search:1"]="off",
        });

        Assert.Equal(["usda"],catalog.SearchProviders.Select(provider=>provider.Id));
        Assert.Equal(["off"],catalog.BarcodeProviders.Select(provider=>provider.Id));
    }

    /// fatsecret is retired: its credentials and order ids may linger in an old configuration,
    /// but they must not register a provider or fail startup.
    [Fact]
    public void Retired_fatsecret_configuration_is_ignored()
    {
        var (catalog,_)=Build(new()
        {
            ["FoodProviders:FatSecret:ClientId"]="id",
            ["FoodProviders:FatSecret:ClientSecret"]="secret",
            ["FoodProviders:Search:0"]="fatsecret",
            ["FoodProviders:Search:1"]="usda",
            ["FoodProviders:Barcode:0"]="fatsecret",
            ["FoodProviders:Barcode:1"]="off",
        });

        Assert.Equal(["usda"],catalog.SearchProviders.Select(provider=>provider.Id));
        Assert.Equal(["off"],catalog.BarcodeProviders.Select(provider=>provider.Id));
    }

    [Fact]
    public void Development_falls_back_to_the_shared_usda_demo_key()
    {
        var (catalog,_)=Build([],development:true);

        Assert.Contains(catalog.BarcodeProviders,provider=>provider.Id=="usda-branded");
    }
}
