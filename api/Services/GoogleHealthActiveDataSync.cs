using Nutrition.Api.Data;

namespace Nutrition.Api.Services;

/// Awaited active-user work; never depends on CPU after a response has completed.
public static class GoogleHealthActiveDataSync
{
    public static async Task RunAsync(AppDb db, IServiceScopeFactory scopes, GoogleHealthWeightImportService import,
        ILogger logger, bool force, CancellationToken ct)
    {
        try { await GoogleHealthOutboundSync.RunAsync(scopes, db.CurrentUser!.Value, GoogleHealthOutboundSync.ActiveUserBudget, ct); }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Google Health uploads were deferred to a later active pass or daily sweep: {FailureType}.", ex.GetType().Name);
        }
        // Upload scopes may have changed the connection revision; discard a tracked copy.
        db.ChangeTracker.Clear();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(6));
        try { await import.RunAsync(force, deadline.Token); }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Google Health weigh-in import was deferred: {FailureType}.", ex.GetType().Name);
        }
        db.ChangeTracker.Clear();
    }
}
