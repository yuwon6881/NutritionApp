namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Registers every food provider with its own named HTTP client. Adding a provider is one class,
/// one line here, and its id in <c>FoodProviders:Search</c> or <c>FoodProviders:Barcode</c>.
/// A provider without credentials is left out and reported, never a startup failure.
/// </summary>
public static class FoodProviderRegistration
{
    public static IReadOnlyList<string> AddFoodProviders(this IServiceCollection services,IConfiguration config,bool development)
    {
        var skipped=new List<string>();
        services.AddSingleton(FoodProviderOrder.FromConfiguration(config));
        services.AddSingleton<FoodProviderHealth>();
        services.AddTransient<FoodCatalog>();

        if(typeof(UsdaGenericDataset).Assembly.GetManifestResourceInfo(UsdaGenericDataset.ResourceName) is null)
            skipped.Add("usda: the bundled dataset is missing from this build.");
        else
        {
            // Parsing the bundled dataset takes a moment, so it happens on the first search rather
            // than on every cold start that never searches.
            services.AddSingleton(_=>new UsdaGenericProvider(UsdaGenericDataset.Embedded()!));
            services.AddSingleton<IFoodProvider>(provider=>provider.GetRequiredService<UsdaGenericProvider>());
        }

        // Open Food Facts asks every read to identify its caller or risk being served as a bot.
        Add<OpenFoodFactsProvider>(services,client=>
        {
            client.Timeout=TimeSpan.FromSeconds(20);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("NutritionCoach/1.0 (two-user personal nutrition tracker)");
        });
        if(FatSecretOptions.FromConfiguration(config) is { } fatSecret)
        {
            services.AddSingleton(fatSecret);
            Add<FatSecretProvider>(services,client=>client.Timeout=TimeSpan.FromSeconds(10));
        }
        else skipped.Add("fatsecret: FoodProviders:FatSecret:ClientId and ClientSecret are not configured.");

        if(UsdaBrandedOptions.FromConfiguration(config,development) is { } usda)
        {
            services.AddSingleton(usda);
            Add<UsdaBrandedProvider>(services,client=>client.Timeout=TimeSpan.FromSeconds(10));
        }
        else skipped.Add("usda-branded: FoodProviders:Usda:ApiKey is not configured.");

        return skipped;
    }

    private static void Add<TProvider>(IServiceCollection services,Action<HttpClient> configure) where TProvider:class,IFoodProvider
    {
        services.AddHttpClient<TProvider>(configure).AddHttpMessageHandler<ExternalCallMetricsHandler>();
        services.AddTransient<IFoodProvider>(provider=>provider.GetRequiredService<TProvider>());
    }
}
