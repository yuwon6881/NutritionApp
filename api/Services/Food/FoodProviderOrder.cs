using System.Collections.Concurrent;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Which providers run, and in what order. Search order doubles as merge priority; barcode order is
/// the lookup chain. An id with no registered provider (for example one missing credentials) is
/// skipped, so configuration can name every provider the deployment might have.
/// </summary>
public sealed class FoodProviderOrder(IReadOnlyList<string> search,IReadOnlyList<string> barcode)
{
    public static readonly IReadOnlyList<string> DefaultSearch=["usda","fatsecret","off"];
    public static readonly IReadOnlyList<string> DefaultBarcode=["off","fatsecret","usda-branded"];

    public IReadOnlyList<string> Search { get; }=search;
    public IReadOnlyList<string> Barcode { get; }=barcode;

    public static FoodProviderOrder FromConfiguration(IConfiguration config)
    {
        static IReadOnlyList<string> Read(IConfigurationSection section,IReadOnlyList<string> fallback)
        {
            var ids=section.GetChildren().Select(child=>child.Value?.Trim()).OfType<string>().Where(id=>id.Length>0).ToArray();
            return ids.Length>0?ids:fallback;
        }
        return new FoodProviderOrder(
            Read(config.GetSection("FoodProviders:Search"),DefaultSearch),
            Read(config.GetSection("FoodProviders:Barcode"),DefaultBarcode));
    }

    /// <summary>Uses the order providers were given in, for tests and single-provider setups.</summary>
    public static FoodProviderOrder Registration(IReadOnlyList<IFoodProvider> providers)
    {
        var ids=providers.Select(provider=>provider.Id).ToArray();
        return new FoodProviderOrder(ids,ids);
    }

    public IReadOnlyList<IFoodProvider> Select(IReadOnlyList<IFoodProvider> providers,IReadOnlyList<string> ids,FoodCapability capability)
        =>ids.Distinct(StringComparer.Ordinal)
            .Select(id=>providers.FirstOrDefault(provider=>provider.Id==id))
            .OfType<IFoodProvider>()
            .Where(provider=>provider.Capabilities.HasFlag(capability))
            .ToArray();
}

/// <summary>Process-wide breaker per provider; the catalog itself is created per request.</summary>
public sealed class FoodProviderHealth
{
    private readonly ConcurrentDictionary<string,ProviderBreaker> breakers=new(StringComparer.Ordinal);
    public ProviderBreaker Breaker(string providerId)=>breakers.GetOrAdd(providerId,_=>new ProviderBreaker());
}
