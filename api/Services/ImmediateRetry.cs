using System.Runtime.ExceptionServices;

namespace Nutrition.Api.Services;

/// <summary>
/// A bounded, immediate retry for calls that failed in a way the caller judges safe to repeat: two more
/// attempts after about half a second and one and a half seconds, so a brief network or provider hiccup is
/// absorbed inside the request that hit it. A pause a provider asks for replaces the default when it is short;
/// a longer one is not waited out here. Cancellation is never swallowed. Whatever survives the retries is
/// returned or thrown unchanged for the caller's own slower recovery (a queue backoff, the daily sweep).
/// </summary>
internal static class ImmediateRetry
{
    /// The pauses before the first and second retry.
    private static readonly TimeSpan[] Backoff = [TimeSpan.FromMilliseconds(500), TimeSpan.FromMilliseconds(1500)];

    /// Beyond this the retry would hold a user's response open; leave it to the caller's slower recovery.
    public static readonly TimeSpan LongestWait = TimeSpan.FromSeconds(3);

    public readonly record struct Verdict(bool Retry, TimeSpan? After = null);

    public static async Task<T> RunAsync<T>(
        Func<Task<T>> call,
        Func<T, Verdict> judgeResult,
        Func<Exception, Verdict> judgeException,
        CancellationToken ct,
        Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        var wait = delay ?? ((pause, token) => Task.Delay(pause + TimeSpan.FromMilliseconds(Random.Shared.Next(0, 200)), token));
        for (var attempt = 0; ; attempt++)
        {
            T result = default!;
            Exception? failure = null;
            Verdict verdict;
            try
            {
                result = await call();
                verdict = judgeResult(result);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                failure = ex;
                verdict = judgeException(ex);
            }

            var pause = verdict.After ?? (attempt < Backoff.Length ? Backoff[attempt] : TimeSpan.Zero);
            if (!verdict.Retry || attempt >= Backoff.Length || pause > LongestWait)
            {
                if (failure is not null) ExceptionDispatchInfo.Capture(failure).Throw();
                return result;
            }
            await wait(pause, ct);
        }
    }
}
