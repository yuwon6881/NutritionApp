using System.Net.Http.Headers;
using System.Text.Json;
using Google.Apis.Auth.OAuth2;

namespace Nutrition.Api.Services;

public sealed record NutritionPushContent(string Title, string Body, string Tag, string Route, TimeSpan TimeToLive);

public enum NutritionPushSendStatus
{
    Sent,
    InvalidOrUnregistered,
    TransientFailure
}

public sealed record NutritionPushSendResult(NutritionPushSendStatus Status);

public interface INutritionPushSender
{
    Task<NutritionPushSendResult> SendAsync(string token, NutritionPushContent content, CancellationToken ct);
}

/// <summary>Sends generic browser notifications through the FCM HTTP v1 API and runtime ADC.</summary>
public sealed class NutritionFcmPushSender(
    HttpClient httpClient,
    IConfiguration configuration,
    ILogger<NutritionFcmPushSender> logger) : INutritionPushSender
{
    private const string MessagingScope = "https://www.googleapis.com/auth/firebase.messaging";
    private GoogleCredential? scopedCredential;

    public async Task<NutritionPushSendResult> SendAsync(string token, NutritionPushContent content, CancellationToken ct)
    {
        var projectId = configuration["Fcm:ProjectId"];
        if (string.IsNullOrWhiteSpace(projectId) || string.Equals(projectId, "__not_configured__", StringComparison.Ordinal))
            return new(NutritionPushSendStatus.TransientFailure);

        string accessToken;
        try
        {
            scopedCredential ??= await BuildScopedCredentialAsync(ct);
            accessToken = await scopedCredential.UnderlyingCredential.GetAccessTokenForRequestAsync(cancellationToken: ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Could not obtain Application Default Credentials for Nutrition push.");
            return new(NutritionPushSendStatus.TransientFailure);
        }

        var payload = new
        {
            message = new
            {
                token,
                webpush = new
                {
                    headers = new Dictionary<string, string>
                    {
                        ["TTL"] = Math.Max(1, (long)content.TimeToLive.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture)
                    }
                },
                data = new Dictionary<string, string>
                {
                    ["kind"] = "check-in",
                    ["title"] = content.Title,
                    ["body"] = content.Body,
                    ["tag"] = content.Tag,
                    ["route"] = content.Route
                }
            }
        };

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://fcm.googleapis.com/v1/projects/{projectId}/messages:send")
        {
            Content = JsonContent.Create(payload)
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(request, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Nutrition FCM send failed before a response was received.");
            return new(NutritionPushSendStatus.TransientFailure);
        }

        using (response)
        {
            if (response.IsSuccessStatusCode) return new(NutritionPushSendStatus.Sent);
            var responseBody = await response.Content.ReadAsStringAsync(ct);
            if (IsInvalidOrUnregistered(responseBody))
                return new(NutritionPushSendStatus.InvalidOrUnregistered);

            logger.LogWarning("Nutrition FCM send failed with status {StatusCode}.", response.StatusCode);
            return new(NutritionPushSendStatus.TransientFailure);
        }
    }

    internal static bool IsInvalidOrUnregistered(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            if (!document.RootElement.TryGetProperty("error", out var error) ||
                !error.TryGetProperty("details", out var details) || details.ValueKind != JsonValueKind.Array)
                return false;

            foreach (var detail in details.EnumerateArray())
            {
                if (!detail.TryGetProperty("@type", out var type) ||
                    type.GetString() is not string typeName ||
                    !typeName.EndsWith("google.firebase.fcm.v1.FcmError", StringComparison.Ordinal))
                    continue;

                if (detail.TryGetProperty("errorCode", out var errorCode) &&
                    errorCode.GetString() is string code &&
                    code is "UNREGISTERED" or "INVALID_ARGUMENT")
                    return true;
            }
        }
        catch (JsonException)
        {
            // Unstructured responses are transient and must not retire a working device token.
        }

        return false;
    }

    private static async Task<GoogleCredential> BuildScopedCredentialAsync(CancellationToken ct)
    {
        var credential = await GoogleCredential.GetApplicationDefaultAsync(ct);
        return credential.IsCreateScopedRequired ? credential.CreateScoped(MessagingScope) : credential;
    }
}
