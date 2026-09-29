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
/// re-arming is idempotent. The task calls the existing dispatcher with the same protected header the
/// scheduler job used; the dispatcher itself decides who is due, so a stale or duplicate task sends nothing.
/// </summary>
public sealed class CloudTasksNutritionWakeQueue(
    HttpClient http,
    IConfiguration configuration,
    ILogger<CloudTasksNutritionWakeQueue> logger) : INutritionWakeQueue
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
            credential ??= (await GoogleCredential.GetApplicationDefaultAsync(ct)).CreateScoped(Scope);
            var accessToken = await credential.UnderlyingCredential.GetAccessTokenForRequestAsync(cancellationToken: ct);
            using var request = new HttpRequestMessage(HttpMethod.Post, $"https://cloudtasks.googleapis.com/v2/{queuePath}/tasks")
            { Content = JsonContent.Create(new { task }) };
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            using var response = await http.SendAsync(request, ct);
            // Conflict means that minute already has (or recently had) its task.
            if (response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.Conflict) return true;
            logger.LogWarning("Nutrition reminder wake-up was not scheduled: Cloud Tasks answered {StatusCode}.", (int)response.StatusCode);
            return false;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            // The daily maintenance run re-arms every enabled reminder, so a failure here is recoverable.
            logger.LogWarning("Nutrition reminder wake-up could not be scheduled ({FailureType}).", ex.GetType().Name);
            return false;
        }
    }
}
