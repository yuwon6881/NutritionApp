namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// The pacing gates of the three Open Food Facts endpoints (free-text search has two). Every
/// request leaves from the one egress address, so production shares a single instance; a test
/// passes its own to stay independent of the slots other tests have spent.
/// </summary>
public sealed class OpenFoodFactsPacing
{
    /// <summary>How long a failed bulk read is remembered before another is tried.</summary>
    public static readonly TimeSpan BulkFailureMemory=TimeSpan.FromSeconds(60);

    public static OpenFoodFactsPacing Shared { get; }=new();

    private long bulkFailedUntilTicks;

    public ProviderGate Search { get; }=new();
    /// <summary>
    /// The brand-scoped follow-up a search sends after its first page. Its own courtesy pace keeps
    /// it from queueing a whole interval behind that page while the merge grace is running.
    /// </summary>
    public ProviderGate SearchFollowUp { get; }=new();
    public ProviderGate Barcode { get; }=new();
    public ProviderGate BatchProduct { get; }=new();

    /// <summary>
    /// True while the bulk read recently failed. Open Food Facts' bulk endpoint fails for stretches
    /// (503 with no retry hint), and trying it again only adds a wait for its slot before the same failure.
    /// </summary>
    public bool BulkRecentlyFailed=>DateTime.UtcNow.Ticks<Interlocked.Read(ref bulkFailedUntilTicks);

    public void NoteBulkFailure()=>Interlocked.Exchange(ref bulkFailedUntilTicks,DateTime.UtcNow.Add(BulkFailureMemory).Ticks);

    public void NoteBulkSuccess()=>Interlocked.Exchange(ref bulkFailedUntilTicks,0);
}
