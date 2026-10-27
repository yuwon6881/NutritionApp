namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Free-text search over the bundled Open Food Facts products. The live service's search index has
/// no serving or unit fields and its product reads are rate limited, so searching it left rows
/// waiting on a confirming read; this answers complete rows at once. Barcodes still go to the live
/// <see cref="OpenFoodFactsProvider"/>, which also knows products newer than the bundled export.
/// </summary>
public sealed class OpenFoodFactsBundledProvider(OpenFoodFactsDataset dataset):IFoodProvider
{
    public const string ProviderId="off-bundled";
    private const int MaxResults=12;

    public string Id=>ProviderId;
    public string Name=>"Open Food Facts";
    public FoodCapability Capabilities=>FoodCapability.Search;
    public bool IsLocal=>true;

    public Task<IReadOnlyList<FoodResult>> Search(string query,PublicFoodCache? durable,CancellationToken ct)
        =>Task.FromResult(BundledFoodSearch.Search(dataset.Entries,query,MaxResults));

    public Task<FoodResult?> Barcode(string code,CancellationToken ct)=>Task.FromResult<FoodResult?>(null);
}
