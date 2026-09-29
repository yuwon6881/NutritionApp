using Nutrition.Api.Services.FoodLookup;

namespace Nutrition.Tests;

/// <summary>Scriptable provider for catalog tests; records every call it receives.</summary>
internal sealed class FakeFoodProvider(string id,FoodCapability capabilities=FoodCapability.Search|FoodCapability.Barcode,bool local=false):IFoodProvider
{
    public string Id=>id;
    public string Name=>"Provider "+id;
    public FoodCapability Capabilities=>capabilities;
    public bool IsLocal=>local;
    public TimeSpan? DurableLifetime { get; init; }
    public TimeSpan SearchTimeout { get; init; }=TimeSpan.FromSeconds(4);

    public Func<string,IReadOnlyList<FoodResult>> OnSearch { get; init; }=_=>[];
    public Func<string,FoodResult?> OnBarcode { get; init; }=_=>null;
    public List<string> SearchCalls { get; }=[];
    public List<string> BarcodeCalls { get; }=[];

    public Task<IReadOnlyList<FoodResult>> Search(string query,PublicFoodCache? durable,CancellationToken ct)
    {
        SearchCalls.Add(query);
        return Task.FromResult(OnSearch(query));
    }

    public Task<FoodResult?> Barcode(string code,CancellationToken ct)
    {
        BarcodeCalls.Add(code);
        return Task.FromResult(OnBarcode(code));
    }

    public static Func<string,T> Fails<T>(FoodProviderFailure failure,string id="x")
        =>_=>throw new FoodProviderException(id,failure);
}

internal static class FoodResultsFor
{
    public static FoodResult Generic(string name,double calories=89,string source="USDA FoodData Central")
        =>new(name,calories,1.1,0.3,22.8,2.6,source,100,[new FoodPortion("1 medium",118)],IsGeneric:true);

    public static FoodResult Branded(string name,string? code,double calories=90,string source="Open Food Facts / ODbL")
        =>new(name,calories,null,null,null,null,code is null?source:source+" / "+code,100,[],code,null,"unverified");
}
