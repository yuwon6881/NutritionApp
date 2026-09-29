using Nutrition.Api.Domain;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// The only place provider failures become user text. Each message names the remedy it actually
/// has: a shed or paced request is a wait, an outage is a retry, missing data is a label scan.
/// </summary>
public static class FoodLookupErrors
{
    public static DomainException Search(string providerName,FoodProviderFailure failure)=>failure switch
    {
        FoodProviderFailure.Busy=>new DomainException($"Food search is busy at {providerName}. Wait a few seconds and search again, or use custom food, recent foods, or AI describe.",429),
        FoodProviderFailure.Throttled=>new DomainException("Please wait a moment before searching again.",429),
        _=>new DomainException("Food search is temporarily unavailable. Your diary is still available.",503),
    };

    public static DomainException Barcode(string providerName,FoodProviderFailure failure)=>failure switch
    {
        FoodProviderFailure.Throttled=>new DomainException("Wait a few seconds before another barcode lookup.",429),
        FoodProviderFailure.Busy=>new DomainException($"Barcode lookup is busy at {providerName}. Retry in a few seconds or use manual recovery.",429),
        FoodProviderFailure.Unreachable=>new DomainException($"Barcode lookup unavailable at {providerName}. Retry when connected or use manual recovery.",503),
        FoodProviderFailure.TimedOut=>new DomainException($"Barcode lookup timed out at {providerName}. Retry or use manual recovery.",503),
        FoodProviderFailure.InvalidData=>new DomainException("Barcode lookup returned invalid product data. Retry or use manual recovery.",503),
        FoodProviderFailure.Incomplete=>new DomainException("This product has no calorie data. Scan its label.",422),
        _=>new DomainException("Barcode lookup unavailable. Scan the label or enter this food manually.",503),
    };

    public static DomainException BarcodeNotFound()
        =>new("Barcode not found. Scan the label or add a custom food.",404);

    /// <summary>
    /// When several providers failed, surface the one whose remedy is most useful: a short wait
    /// beats a retry, which beats a label scan, because a retry may still find complete data.
    /// </summary>
    public static int Precedence(FoodProviderFailure failure)=>failure switch
    {
        FoodProviderFailure.Busy=>0,
        FoodProviderFailure.Throttled=>1,
        FoodProviderFailure.Incomplete=>3,
        _=>2,
    };
}
