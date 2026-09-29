namespace Nutrition.Api.Services;

/// The shape every Google Health provider failure shares, so one retry policy can judge all of them.
internal interface IGoogleHealthProviderFailure
{
    bool Transient { get; }
    bool UnknownCreate { get; }
    bool AuthenticationFailure { get; }
    TimeSpan? RetryAfter { get; }
}

/// <summary>
/// Immediate retry for Google Health uploads, so a brief Google or network hiccup does not leave an upload
/// waiting for the next visit or the daily sweep. It never repeats a create whose outcome is unknown (a
/// duplicate could exist) or an authentication failure; see <see cref="ImmediateRetry"/> for the bounds.
/// </summary>
internal static class GoogleHealthImmediateRetry
{
    /// Transient provider failures are safe to repeat; unknown creates and authentication failures are not.
    public static ImmediateRetry.Verdict JudgeException(Exception ex)
        => ex is IGoogleHealthProviderFailure { Transient: true, UnknownCreate: false, AuthenticationFailure: false } failure
            ? new(true, failure.RetryAfter)
            : default;

    public static ImmediateRetry.Verdict JudgeResult(GoogleHealthOperationResult result)
        => !result.Success && result.Transient && !result.UnknownCreate && !result.AuthenticationFailure
            ? new(true, result.RetryAfter)
            : default;

    public static Task<GoogleHealthOperationResult> RunAsync(
        Func<Task<GoogleHealthOperationResult>> call, CancellationToken ct, Func<TimeSpan, CancellationToken, Task>? delay = null)
        => ImmediateRetry.RunAsync(call, JudgeResult, JudgeException, ct, delay);
}
