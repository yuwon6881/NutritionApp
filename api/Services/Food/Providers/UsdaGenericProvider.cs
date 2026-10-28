namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Plain whole foods and common dishes ("banana", "cooked white rice") from the bundled USDA
/// dataset. It answers instantly, without quota, and keeps search useful when every network
/// provider is shedding load.
/// </summary>
public sealed class UsdaGenericProvider(UsdaGenericDataset dataset):IFoodProvider
{
    public const string ProviderId="usda";
    public const string Attribution="USDA FoodData Central";
    private const int MaxResults=10;

    public string Id=>ProviderId;
    public string Name=>Attribution;
    public FoodCapability Capabilities=>FoodCapability.Search;
    public bool IsLocal=>true;

    public Task<IReadOnlyList<FoodResult>> Search(string query,PublicFoodCache? durable,CancellationToken ct)
        =>Task.FromResult(BundledFoodSearch.Search(dataset.Entries,query,MaxResults));

    public Task<FoodResult?> Barcode(string code,CancellationToken ct)=>Task.FromResult<FoodResult?>(null);
}
