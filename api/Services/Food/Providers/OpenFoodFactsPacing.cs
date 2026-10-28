namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// The pacing gate of the Open Food Facts product endpoint. Every request leaves from the one
/// egress address, so production shares a single instance; a test passes its own to stay
/// independent of the slots other tests have spent.
/// </summary>
public sealed class OpenFoodFactsPacing
{
    public static OpenFoodFactsPacing Shared { get; }=new();

    public ProviderGate Barcode { get; }=new();
}
