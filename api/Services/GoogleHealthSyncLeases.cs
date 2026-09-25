using Microsoft.Extensions.DependencyInjection;

namespace Nutrition.Api.Services;

/// Lease rules shared by the weight, nutrition, and body-fat upload queues.
internal static class GoogleHealthSyncLeases
{
    /// A scheduled sweep may spend this long per queue before leaving the rest for the next one.
    public static readonly TimeSpan ScheduledBudget = TimeSpan.FromSeconds(45);

    /// States a scheduled run may lease. A "processing" row whose lease has expired belongs to a
    /// run that stopped mid-upload: an instance shutdown, the scheduler deadline, or an
    /// unclassified error. Without it here that row would never be picked up again.
    public static readonly string[] Claimable = ["pending", "processing", "awaiting_operation"];

    /// An interrupted create may already exist in Google Health. It must become "unknown" for
    /// explicit recovery rather than be sent again automatically.
    public static bool IsInterruptedCreate(string state, string resourceName, string operationName, bool deleted)
        => state == "processing" && !deleted
            && string.IsNullOrWhiteSpace(resourceName) && string.IsNullOrWhiteSpace(operationName);
}

public sealed record GoogleHealthOutboundSyncResult(
    GoogleHealthWeightSyncProcessResult Weight,
    GoogleHealthNutritionSyncProcessResult Nutrition,
    GoogleHealthBodyFatSyncProcessResult BodyFat);

/// Runs the three outbound queues together. Uploads are sent while their user is active, when the
/// API and database are already awake, so the scheduled sweep can stay infrequent enough to let
/// both scale to zero between runs.
public static class GoogleHealthOutboundSync
{
    /// Bounds the flush that rides on a user's own request so it never noticeably delays it.
    public static readonly TimeSpan ActiveUserBudget = TimeSpan.FromSeconds(6);

    public static async Task<GoogleHealthOutboundSyncResult> RunAsync(
        IServiceScopeFactory scopes, Guid? userId, TimeSpan? budget, CancellationToken ct)
    {
        // Each queue gets its own scope because a DbContext is not thread-safe; they run in
        // parallel so the whole call stays within one queue's budget.
        var weight = InScope<GoogleHealthWeightSyncService, GoogleHealthWeightSyncProcessResult>(scopes, s => s.ProcessDueAsync(ct, userId, budget));
        var nutrition = InScope<GoogleHealthNutritionSyncService, GoogleHealthNutritionSyncProcessResult>(scopes, s => s.ProcessDueAsync(ct, userId, budget));
        var bodyFat = InScope<GoogleHealthBodyFatSyncService, GoogleHealthBodyFatSyncProcessResult>(scopes, s => s.ProcessDueAsync(ct, userId, budget));
        await Task.WhenAll(weight, nutrition, bodyFat);
        return new(weight.Result, nutrition.Result, bodyFat.Result);
    }

    private static async Task<TResult> InScope<TService, TResult>(IServiceScopeFactory scopes, Func<TService, Task<TResult>> process)
        where TService : notnull
    {
        await using var scope = scopes.CreateAsyncScope();
        return await process(scope.ServiceProvider.GetRequiredService<TService>());
    }
}
