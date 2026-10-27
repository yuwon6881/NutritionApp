namespace Nutrition.Api.Services.FoodLookup;

[Flags]
public enum FoodCapability { None=0, Search=1, Barcode=2 }

/// <summary>
/// One source of food data. A provider maps its own format to <see cref="FoodResult"/> and reports
/// trouble as a <see cref="FoodProviderException"/>; it never writes user-facing text, because only
/// <see cref="FoodCatalog"/> knows whether another provider already answered.
/// </summary>
public interface IFoodProvider
{
    /// <summary>Stable key used in configuration and the durable product cache.</summary>
    string Id { get; }
    /// <summary>Plain provider name for messages, e.g. "Open Food Facts".</summary>
    string Name { get; }
    FoodCapability Capabilities { get; }
    /// <summary>A bundled dataset answers without the network and cannot be busy or down.</summary>
    bool IsLocal => false;
    /// <summary>Upper bound on one search; a slower provider is dropped from that merge.</summary>
    TimeSpan SearchTimeout => TimeSpan.FromSeconds(4);
    /// <summary>How long a barcode hit may be stored durably; null keeps it in memory only.</summary>
    TimeSpan? DurableLifetime => null;

    Task<IReadOnlyList<FoodResult>> Search(string query,PublicFoodCache? durable,CancellationToken ct);
    /// <summary>Null means the provider does not know this barcode.</summary>
    Task<FoodResult?> Barcode(string code,CancellationToken ct);
}

public enum FoodProviderFailure
{
    /// <summary>Our own pacing refused the call before it left the process.</summary>
    Throttled,
    /// <summary>The provider asked us to back off (HTTP 429 or an exhausted quota).</summary>
    Busy,
    /// <summary>The provider answered with an error status.</summary>
    Unavailable,
    /// <summary>The provider could not be reached at all.</summary>
    Unreachable,
    TimedOut,
    InvalidData,
    /// <summary>The product exists but has no calorie data to log.</summary>
    Incomplete,
}

public sealed class FoodProviderException(string providerId,FoodProviderFailure failure,TimeSpan? retryAfter=null)
    : Exception($"Food provider '{providerId}' failed: {failure}.")
{
    public string ProviderId { get; } = providerId;
    public FoodProviderFailure Failure { get; } = failure;
    public TimeSpan? RetryAfter { get; } = retryAfter;
}
