using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// A brief Google or network hiccup is retried at once; anything that could duplicate data or that the
/// provider asked us to wait out is left to the queue.
public sealed class GoogleHealthImmediateRetryTests
{
    private static readonly GoogleHealthOperationResult Done = new(true, true, ResourceName: "users/me/dataPoints/1");
    private static Task NoWait(TimeSpan pause, CancellationToken ct) => Task.CompletedTask;

    [Fact]
    public async Task A_transient_failure_is_retried_after_a_short_pause_and_then_succeeds()
    {
        var pauses = new List<TimeSpan>();
        var calls = 0;

        var result = await GoogleHealthImmediateRetry.RunAsync(
            () => ++calls == 1
                ? throw new GoogleHealthWeightProviderException("provider_unavailable", "503", transient: true)
                : Task.FromResult(Done),
            default,
            (pause, _) => { pauses.Add(pause); return Task.CompletedTask; });

        Assert.Same(Done, result);
        Assert.Equal(2, calls);
        Assert.Equal([TimeSpan.FromMilliseconds(500)], pauses);
    }

    [Fact]
    public async Task A_persistent_transient_failure_stops_after_two_retries_and_surfaces_the_original_error()
    {
        var calls = 0;
        var failure = new GoogleHealthNutritionProviderException("provider_unavailable", "503", transient: true);

        var thrown = await Assert.ThrowsAsync<GoogleHealthNutritionProviderException>(
            () => GoogleHealthImmediateRetry.RunAsync(() => { calls++; throw failure; }, default, NoWait));

        Assert.Same(failure, thrown);
        Assert.Equal(3, calls);
    }

    [Fact]
    public async Task An_unknown_create_is_never_retried_because_a_duplicate_may_exist()
    {
        var calls = 0;

        await Assert.ThrowsAsync<GoogleHealthBodyFatProviderException>(() => GoogleHealthImmediateRetry.RunAsync(
            () => { calls++; throw new GoogleHealthBodyFatProviderException("upload_status_unknown", "lost", unknownCreate: true, transient: true); },
            default,
            NoWait));

        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Authentication_and_permanent_failures_are_not_retried()
    {
        var calls = 0;
        await Assert.ThrowsAsync<GoogleHealthWeightProviderException>(() => GoogleHealthImmediateRetry.RunAsync(
            () => { calls++; throw new GoogleHealthWeightProviderException("auth", "401", transient: true, authenticationFailure: true); },
            default,
            NoWait));
        await Assert.ThrowsAsync<GoogleHealthWeightProviderException>(() => GoogleHealthImmediateRetry.RunAsync(
            () => { calls++; throw new GoogleHealthWeightProviderException("invalid", "400"); },
            default,
            NoWait));

        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task A_short_retry_after_replaces_the_default_pause_and_a_long_one_is_left_to_the_queue()
    {
        var pauses = new List<TimeSpan>();
        var calls = 0;
        await GoogleHealthImmediateRetry.RunAsync(
            () => ++calls == 1
                ? throw new GoogleHealthWeightProviderException("rate", "429", transient: true, retryAfter: TimeSpan.FromSeconds(1))
                : Task.FromResult(Done),
            default,
            (pause, _) => { pauses.Add(pause); return Task.CompletedTask; });
        Assert.Equal([TimeSpan.FromSeconds(1)], pauses);

        var longCalls = 0;
        await Assert.ThrowsAsync<GoogleHealthWeightProviderException>(() => GoogleHealthImmediateRetry.RunAsync(
            () => { longCalls++; throw new GoogleHealthWeightProviderException("rate", "429", transient: true, retryAfter: TimeSpan.FromSeconds(30)); },
            default,
            NoWait));
        Assert.Equal(1, longCalls);
    }

    [Fact]
    public async Task A_transient_operation_result_is_retried_but_an_unknown_create_result_is_not()
    {
        var calls = 0;
        var result = await GoogleHealthImmediateRetry.RunAsync(
            () => Task.FromResult(++calls == 1
                ? new GoogleHealthOperationResult(true, false, Transient: true, ErrorCategory: "provider_unavailable")
                : Done),
            default,
            NoWait);
        Assert.Same(Done, result);

        var unknownCalls = 0;
        var unknown = await GoogleHealthImmediateRetry.RunAsync(
            () =>
            {
                unknownCalls++;
                return Task.FromResult(new GoogleHealthOperationResult(true, false, Transient: true, UnknownCreate: true));
            },
            default,
            NoWait);
        Assert.False(unknown.Success);
        Assert.Equal(1, unknownCalls);
    }

    [Fact]
    public async Task Cancellation_is_never_swallowed_or_retried()
    {
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        var calls = 0;

        await Assert.ThrowsAsync<OperationCanceledException>(() => GoogleHealthImmediateRetry.RunAsync(
            () => { calls++; throw new OperationCanceledException(cancelled.Token); },
            cancelled.Token,
            NoWait));

        Assert.Equal(1, calls);
    }
}
