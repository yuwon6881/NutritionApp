using System.Net;
using System.Text;
using Google.Apis.Auth.OAuth2;

namespace Nutrition.Api.Services;

/// Schedules a wake-up for the reminder dispatcher, replacing a scheduler job that polled every few minutes.
public interface INutritionWakeQueue
{
    bool Configured { get; }
    /// Ensures one task will call the dispatcher at <paramref name="at"/>. True when it exists afterwards.
    Task<bool> EnsureWakeAsync(DateTimeOffset at, CancellationToken ct);
}

/// <summary>
/// Creates one named Cloud Tasks HTTP task per due minute, so simultaneous reminders share a wake-up and
/// re-arming is idempotent (which is also what makes retrying a lost response safe). The task calls the
/// existing dispatcher with the same protected header the scheduler job used; the dispatcher itself decides
/// who is due, so a stale or duplicate task sends nothing. A temporary failure (network, credentials, a 429
/// or 5xx) is retried immediately; anything still failing is repaired by the daily maintenance run.
/// </summary>
public sealed class CloudTasksNutritionWakeQueue(
    HttpClient http,
    IConfiguration configuration,
    ILogger<CloudTasksNutritionWakeQueue> logger,
    Func<CancellationToken, Task<string>>? accessToken = null,
    Func<TimeSpan, CancellationToken, Task>? retryDelay = null) : INutritionWakeQueue
{
    private const string Scope = "https://www.googleapis.com/auth/cloud-tasks";
    private GoogleCredential? credential;

    private string ProjectId => configuration["CloudTasks:ProjectId"] ?? "";
    private string Location => configuration["CloudTasks:Location"] ?? "";
    private string Queue => configuration["CloudTasks:Queue"] ?? "";
    private string TargetUrl => configuration["CloudTasks:TargetUrl"] ?? "";
    private string CleanupToken => configuration["Cleanup:Token"] ?? "";

    public bool Configured => !string.IsNullOrWhiteSpace(ProjectId) && !string.IsNullOrWhiteSpace(Location)
        && !string.IsNullOrWhiteSpace(Queue) && !string.IsNullOrWhiteSpace(CleanupToken)
        && Uri.TryCreate(TargetUrl, UriKind.Absolute, out var target) && target.Scheme == Uri.UriSchemeHttps;

    public async Task<bool> EnsureWakeAsync(DateTimeOffset at, CancellationToken ct)
    {
        if (!Configured) return false;
        var when = at.ToUniversalTime();
        var queuePath = $"projects/{Uri.EscapeDataString(ProjectId)}/locations/{Uri.EscapeDataString(Location)}/queues/{Uri.EscapeDataString(Queue)}";
        var task = new
        {
            name = $"{queuePath}/tasks/checkin-wake-{when:yyyyMMddHHmm}",
            scheduleTime = when.ToString("O", System.Globalization.CultureInfo.InvariantCulture),
            httpRequest = new
            {
                httpMethod = "POST",
                url = TargetUrl,
                headers = new Dictionary<string, string> { ["Content-Type"] = "application/json", ["X-Cleanup-Token"] = CleanupToken },
                body = Convert.ToBase64String(Encoding.UTF8.GetBytes("{}"))
            }
        };

        try
        {
            var status = await ImmediateRetry.RunAsync(
                () => SendAsync(queuePath, task, ct),
                code => new(IsTemporary(code)),
                // Network errors, timeouts and credential hiccups are all worth another try.
                _ => new(true),
                ct,
                retryDelay);
            // Conflict means that minute already has (or recently had) its task.
            if ((int)status is >= 200 and < 300 || status == HttpStatusCode.Conflict) return true;
            logger.LogWarning("Nutrition reminder wake-up was not scheduled: Cloud Tasks answered {StatusCode}.", (int)status);
            return false;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            // The daily maintenance run re-arms every enabled reminder, so a failure here is recoverable.
            logger.LogWarning("Nutrition reminder wake-up could not be scheduled ({FailureType}).", ex.GetType().Name);
            return false;
        }
    }

    private static bool IsTemporary(HttpStatusCode code) => code == HttpStatusCode.TooManyRequests || (int)code >= 500;

    private async Task<HttpStatusCode> SendAsync(string queuePath, object task, CancellationToken ct)
    {
        var token = await AccessTokenAsync(ct);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"https://cloudtasks.googleapis.com/v2/{queuePath}/tasks")
        { Content = JsonContent.Create(new { task }) };
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        using var response = await http.SendAsync(request, ct);
        return response.StatusCode;
    }

    private async Task<string> AccessTokenAsync(CancellationToken ct)
    {
        if (accessToken is not null) return await accessToken(ct);
        credential ??= (await GoogleCredential.GetApplicationDefaultAsync(ct)).CreateScoped(Scope);
        return await credential.UnderlyingCredential.GetAccessTokenForRequestAsync(cancellationToken: ct);
    }
}
