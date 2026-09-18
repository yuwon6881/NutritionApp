using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record GoogleHealthDay(DateOnly Date, int? Count);

public sealed record GoogleHealthSyncResult(
    string Status,
    DateTime? ConnectedAt,
    DateTime? LastSyncedAt,
    string Freshness,
    IReadOnlyList<GoogleHealthDay> Days,
    string? WarningCode = null,
    string? WarningMessage = null,
    GoogleHealthWeightSyncStatus? WeightSync = null
);

public sealed record GoogleHealthConnectResult(string AuthUrl);

public class GoogleHealthService(HttpClient http, AppDb db, IGoogleHealthKms kms, IConfiguration config, ILogger<GoogleHealthService>? logger = null)
{
    private const string GoogleSourcesDataSourceFamily = "users/me/dataSourceFamilies/google-sources";

    private sealed class GoogleHealthRequestException(
        string stage,
        HttpStatusCode statusCode,
        string? providerReason = null) : Exception
    {
        public string Stage { get; } = stage;
        public HttpStatusCode StatusCode { get; } = statusCode;
        public string? ProviderReason { get; } = providerReason;
    }

    private static readonly ConcurrentDictionary<Guid, Task<GoogleHealthSyncResult>> InFlightSyncs = new();
    private static readonly ConcurrentDictionary<Guid, (DateTime SyncedAt, GoogleHealthSyncResult Result)> MemoryCache = new();

    public static void InvalidateMemoryCache(Guid userId) => MemoryCache.TryRemove(userId, out _);
    public static void ClearMemoryCache() => MemoryCache.Clear();

    public const string Scope = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";

    public string ClientId => (config["GoogleHealth:ClientId"] ?? config["GoogleHealthClientId"] ?? "").Trim();
    public string ClientSecret => (config["GoogleHealth:ClientSecret"] ?? config["GoogleHealthClientSecret"] ?? "").Trim();

    public string GetCallbackUrl(string? requestOrigin)
    {
        var origin = (config["PublicOrigin"] ?? requestOrigin ?? "").TrimEnd('/');
        Validation.Require(!string.IsNullOrEmpty(origin), "Server origin is not configured.", 500);
        return $"{origin}/api/integrations/google-health/callback";
    }

    public async Task<GoogleHealthConnectResult> GenerateConnectUrlAsync(Guid userId, string sessionHash, string? requestOrigin, CancellationToken ct, bool requestWeightSync = false)
    {
        Validation.Require(!string.IsNullOrEmpty(ClientId), "Google Health integration is not configured.", 503);

        var stateNonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var callbackUrl = GetCallbackUrl(requestOrigin);

        var oauthState = new GoogleHealthOAuthState
        {
            State = stateNonce,
            UserId = userId,
            SessionHash = sessionHash,
            RequestedOperationsJson = JsonSerializer.Serialize(requestWeightSync ? new[] { "weight_write" } : Array.Empty<string>()),
            RequestedScopesJson = JsonSerializer.Serialize(requestWeightSync ? new[] { Scope, GoogleHealthWeightSyncService.WeightScope } : new[] { Scope }),
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddMinutes(10)
        };

        db.GoogleHealthOAuthStates.Add(oauthState);
        await db.SaveChangesAsync(ct);

        var query = new Dictionary<string, string>
        {
            ["client_id"] = ClientId,
            ["redirect_uri"] = callbackUrl,
            ["response_type"] = "code",
            ["scope"] = requestWeightSync ? $"openid {Scope} {GoogleHealthWeightSyncService.WeightScope}" : $"openid {Scope}",
            ["access_type"] = "offline",
            ["prompt"] = "consent",
            ["state"] = stateNonce
        };

        var queryString = string.Join("&", query.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        var authUrl = $"https://accounts.google.com/o/oauth2/v2/auth?{queryString}";

        return new GoogleHealthConnectResult(authUrl);
    }

    public async Task<string> HandleCallbackAsync(string? code, string? state, string? error, Guid userId, string sessionHash, string? requestOrigin, CancellationToken ct)
    {
        var correlationId = Guid.NewGuid().ToString("N")[..12];
        string Failure(string failureCode, string stage)
        {
            logger?.LogWarning("Google Health OAuth failed at {Stage}; code {Code}; correlation {CorrelationId}.", stage, failureCode, correlationId);
            return $"/settings?google_health=error&code={Uri.EscapeDataString(failureCode)}";
        }

        if (!string.IsNullOrEmpty(error))
        {
            var providerCode = error.Length <= 64 && error.All(ch => char.IsLetterOrDigit(ch) || ch is '_' or '-')
                ? error
                : "provider_error";
            return Failure(providerCode, "provider");
        }

        if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
            return Failure("missing_parameters", "callback_parameters");

        // Validate state nonce
        var oauthState = await db.GoogleHealthOAuthStates.IgnoreQueryFilters().SingleOrDefaultAsync(s => s.State == state, ct);
        if (oauthState == null || oauthState.ExpiresAt < DateTime.UtcNow)
        {
            if (oauthState != null)
            {
                db.GoogleHealthOAuthStates.Remove(oauthState);
                await db.SaveChangesAsync(ct);
            }
            return Failure("invalid_state", "state_lookup");
        }

        if (oauthState.UserId != userId || oauthState.SessionHash != sessionHash)
        {
            db.GoogleHealthOAuthStates.Remove(oauthState);
            await db.SaveChangesAsync(ct);
            return Failure("session_mismatch", "state_binding");
        }

        // Single-use: remove state immediately
        db.GoogleHealthOAuthStates.Remove(oauthState);
        await db.SaveChangesAsync(ct);

        // Exchange code for tokens
        var callbackUrl = GetCallbackUrl(requestOrigin);
        var tokenBody = new Dictionary<string, string>
        {
            ["code"] = code,
            ["client_id"] = ClientId,
            ["client_secret"] = ClientSecret,
            ["redirect_uri"] = callbackUrl,
            ["grant_type"] = "authorization_code"
        };

        using var tokenReq = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token")
        {
            Content = new FormUrlEncodedContent(tokenBody)
        };

        HttpResponseMessage tokenRes;
        try
        {
            tokenRes = await http.SendAsync(tokenReq, ct);
        }
        catch
        {
            return Failure("token_exchange_failed", "token_exchange");
        }
        if (!tokenRes.IsSuccessStatusCode)
            return Failure("token_exchange_failed", "token_exchange");

        var tokenJson = await tokenRes.Content.ReadAsStringAsync(ct);
        JsonDocument tokenDoc;
        try
        {
            tokenDoc = JsonDocument.Parse(tokenJson);
        }
        catch
        {
            return Failure("token_exchange_failed", "token_response");
        }
        using (tokenDoc)
        {
        var root = tokenDoc.RootElement;

        var accessToken = root.TryGetProperty("access_token", out var atProp) ? atProp.GetString() : null;
        var refreshToken = root.TryGetProperty("refresh_token", out var rtProp) ? rtProp.GetString() : null;
        var returnedScopes = root.TryGetProperty("scope", out var scopeProp) && scopeProp.ValueKind == JsonValueKind.String
            ? scopeProp.GetString()?.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.Ordinal).ToArray()
            : null;

        if (string.IsNullOrEmpty(accessToken) || string.IsNullOrEmpty(refreshToken))
            return Failure("missing_tokens", "token_exchange");

        // Resolve Google Identity (sub)
        var googleId = await ResolveGoogleIdentityAsync(accessToken, ct);
        if (string.IsNullOrEmpty(googleId))
            return Failure("identity_resolution_failed", "identity_lookup");

        var googleIdHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(googleId))).ToLowerInvariant();

        // Enforce one Google Health identity per Nutrition account across all tenants
        var duplicate = await db.GoogleHealthConnections.IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.GoogleIdHash == googleIdHash && c.UserId != userId, ct);
        if (duplicate != null)
            return Failure("duplicate_account", "account_binding");

        // Encrypt with KMS
        string encryptedGoogleId;
        string encryptedRefreshToken;
        string emptyHistory;
        try
        {
            encryptedGoogleId = await kms.EncryptAsync(googleId, ct);
            encryptedRefreshToken = await kms.EncryptAsync(refreshToken, ct);
            emptyHistory = await kms.EncryptAsync("[]", ct);
        }
        catch
        {
            return Failure("encryption_failed", "kms_encryption");
        }

        var existingConn = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (existingConn != null && existingConn.GoogleIdHash != googleIdHash)
            return Failure("identity_change_requires_disconnect", "account_binding");
        string[]? requestedScopes = null;
        try { requestedScopes = JsonSerializer.Deserialize<string[]>(oauthState.RequestedScopesJson, Json.Options); }
        catch (JsonException) { requestedScopes = null; }
        string[]? storedScopes = null;
        if (existingConn != null && !string.IsNullOrWhiteSpace(existingConn.GrantedScopesJson))
        {
            try { storedScopes = JsonSerializer.Deserialize<string[]>(existingConn.GrantedScopesJson, Json.Options); }
            catch (JsonException) { storedScopes = null; }
        }
        var grantedScopes = returnedScopes
            ?? (requestedScopes is { Length: > 0 }
                ? requestedScopes
                : storedScopes is { Length: > 0 } ? storedScopes : new[] { Scope });
        var requestedWeight = oauthState.RequestedOperationsJson.Contains("weight_write", StringComparison.Ordinal);
        var weightGranted = grantedScopes.Contains(GoogleHealthWeightSyncService.WeightScope, StringComparer.Ordinal);
        var weightEnabled = existingConn?.WeightSyncEnabled == true && !requestedWeight || weightGranted && requestedWeight;
        if (existingConn != null)
        {
            existingConn.GoogleIdHash = googleIdHash;
            existingConn.EncryptedGoogleId = encryptedGoogleId;
            existingConn.EncryptedRefreshToken = encryptedRefreshToken;
            existingConn.EncryptedStepHistoryJson = emptyHistory;
            existingConn.GrantedScopesJson = JsonSerializer.Serialize(grantedScopes);
            existingConn.WeightSyncEnabled = weightEnabled;
            existingConn.ConnectedAt = DateTime.UtcNow;
            existingConn.LastSyncedAt = null;
            existingConn.Status = "connected";
            existingConn.Revision++;
        }
        else
        {
            db.GoogleHealthConnections.Add(new GoogleHealthConnection
            {
                UserId = userId,
                GoogleIdHash = googleIdHash,
                EncryptedGoogleId = encryptedGoogleId,
                EncryptedRefreshToken = encryptedRefreshToken,
                EncryptedStepHistoryJson = emptyHistory,
                GrantedScopesJson = JsonSerializer.Serialize(grantedScopes),
                WeightSyncEnabled = weightGranted && requestedWeight,
                ConnectedAt = DateTime.UtcNow,
                LastSyncedAt = null,
                Status = "connected",
                Revision = 1
            });
        }

        await db.SaveChangesAsync(ct);
        MemoryCache.TryRemove(userId, out _);

        return "/settings?google_health=connected";
        }
    }

    public async Task<string?> GetAccessTokenAsync(Guid userId, string requiredScope, CancellationToken ct)
    {
        var conn = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (conn is null || conn.Status == "reconnect_required" || !HasGrantedScope(conn, requiredScope)) return null;
        string refreshToken;
        try
        {
            refreshToken = await kms.DecryptAsync(conn.EncryptedRefreshToken, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return null;
        }

        var (accessToken, revoked, _) = await RefreshAccessTokenAsync(refreshToken, ct);
        if (!revoked) return accessToken;
        conn.Status = "reconnect_required";
        conn.EncryptedRefreshToken = "";
        conn.Revision++;
        await db.SaveChangesAsync(ct);
        MemoryCache.TryRemove(userId, out _);
        return null;
    }

    public async Task MarkReconnectRequiredAsync(Guid userId, CancellationToken ct)
    {
        db.CurrentUser = userId;
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(ct);
        if (connection is null || connection.Status == "reconnect_required") return;
        connection.Status = "reconnect_required";
        connection.EncryptedRefreshToken = "";
        connection.Revision++;
        await db.SaveChangesAsync(ct);
        MemoryCache.TryRemove(userId, out _);
    }

    private static bool HasGrantedScope(GoogleHealthConnection connection, string requiredScope)
    {
        try
        {
            var scopes = JsonSerializer.Deserialize<string[]>(connection.GrantedScopesJson, Json.Options) ?? [];
            return scopes.Contains(requiredScope, StringComparer.Ordinal);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public async Task<GoogleHealthSyncResult> DisconnectAsync(Guid userId, CancellationToken ct)
    {
        var conn = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (conn == null)
            return new GoogleHealthSyncResult("disconnected", null, null, "unavailable", []);

        // Upstream revocation attempt
        try
        {
            if (!string.IsNullOrEmpty(conn.EncryptedRefreshToken))
            {
                var refreshToken = await kms.DecryptAsync(conn.EncryptedRefreshToken, ct);
                if (!string.IsNullOrEmpty(refreshToken))
                {
                    using var revokeReq = new HttpRequestMessage(HttpMethod.Post, $"https://oauth2.googleapis.com/revoke?token={Uri.EscapeDataString(refreshToken)}");
                    await http.SendAsync(revokeReq, ct);
                }
            }
        }
        catch
        {
            // Revocation is best-effort before local deletion
        }

        await db.GoogleHealthWeightSyncWork
            .Where(x => x.UserId == userId)
            .ExecuteDeleteAsync(ct);
        db.GoogleHealthConnections.Remove(conn);
        await db.SaveChangesAsync(ct);
        MemoryCache.TryRemove(userId, out _);

        return new GoogleHealthSyncResult("disconnected", null, null, "unavailable", []);
    }

    public async Task<GoogleHealthSyncResult> SyncAsync(Guid userId, CancellationToken ct, bool force = false)
    {
        // Check 2-minute memory cache
        if (!force && MemoryCache.TryGetValue(userId, out var cached) && (DateTime.UtcNow - cached.SyncedAt) < TimeSpan.FromMinutes(2))
        {
            return await AttachWeightStatusAsync(userId, cached.Result, ct);
        }

        // Coalesce concurrent calls for the same user
        while (true)
        {
            if (InFlightSyncs.TryGetValue(userId, out var existingTask))
            {
                try
                {
                    return await AttachWeightStatusAsync(userId, await existingTask, ct);
                }
                catch
                {
                    // Fallthrough to retry if in-flight failed
                }
            }

            var tcs = new TaskCompletionSource<GoogleHealthSyncResult>();
            if (InFlightSyncs.TryAdd(userId, tcs.Task))
            {
                try
                {
                    var result = await PerformSyncAsync(userId, ct, force);
                    if (result.Status == "connected" && result.Freshness == "fresh")
                    {
                        MemoryCache[userId] = (DateTime.UtcNow, result);
                    }
                    tcs.SetResult(result);
                    return await AttachWeightStatusAsync(userId, result, ct);
                }
                catch (Exception ex)
                {
                    tcs.SetException(ex);
                    throw;
                }
                finally
                {
                    InFlightSyncs.TryRemove(userId, out _);
                }
            }
        }
    }

    private async Task<GoogleHealthSyncResult> AttachWeightStatusAsync(Guid userId, GoogleHealthSyncResult result, CancellationToken ct)
    {
        var connection = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (connection is null) return result with { WeightSync = new(false, false, "disabled", 0, null, 0) };
        string[] granted;
        try { granted = JsonSerializer.Deserialize<string[]>(connection.GrantedScopesJson, Json.Options) ?? []; }
        catch (JsonException) { granted = []; }
        var work = await db.GoogleHealthWeightSyncWork.ToListAsync(ct);
        var pending = work.Count(x => x.ProcessingState is "pending" or "processing" or "awaiting_operation");
        var problem = work.Where(x => x.ProcessingState is "failed" or "unknown").OrderByDescending(x => x.UpdatedAt).FirstOrDefault();
        var state = !connection.WeightSyncEnabled ? "disabled"
            : connection.Status == "reconnect_required" ? "reconnect_required"
            : problem?.ProcessingState ?? (pending > 0 ? "pending" : "idle");
        return result with
        {
            WeightSync = new(
                connection.WeightSyncEnabled,
                granted.Contains(GoogleHealthWeightSyncService.WeightScope, StringComparer.Ordinal),
                state,
                pending,
                connection.WeightLastSuccessfulSyncAt,
                connection.WeightSyncRevision,
                problem?.LastErrorCategory,
                problem?.LastErrorMessage)
        };
    }

    private async Task<GoogleHealthSyncResult> PerformSyncAsync(Guid userId, CancellationToken ct, bool force)
    {
        var conn = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (conn == null)
            return new GoogleHealthSyncResult("disconnected", null, null, "unavailable", []);

        if (conn.Status == "reconnect_required")
            return new GoogleHealthSyncResult("reconnect_required", conn.ConnectedAt, conn.LastSyncedAt, "unavailable", [], "credentials_revoked", "Google Health authorization was revoked. Please reconnect.");

        // Check if DB record has recent sync within 2 minutes
        if (!force && conn.LastSyncedAt.HasValue && (DateTime.UtcNow - conn.LastSyncedAt.Value) < TimeSpan.FromMinutes(2))
        {
            try
            {
                var decryptedDays = await DecryptDaysAsync(conn.EncryptedStepHistoryJson, ct);
                return new GoogleHealthSyncResult("connected", conn.ConnectedAt, conn.LastSyncedAt, "fresh", decryptedDays);
            }
            catch
            {
                // If decryption failed, continue with full sync
            }
        }

        // Refresh access token using KMS-decrypted refresh token
        string refreshToken;
        try
        {
            refreshToken = await kms.DecryptAsync(conn.EncryptedRefreshToken, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Transient KMS error: return cached result marked as stale if available
            return await ReturnStaleOrUnavailable(conn, "kms_error", "KMS service is temporarily unavailable.", ct);
        }

        var (accessToken, isRevoked, refreshError) = await RefreshAccessTokenAsync(refreshToken, ct);
        if (isRevoked)
        {
            // Confirmed revoked: delete imported step data and require reconnection
            conn.Status = "reconnect_required";
            conn.EncryptedRefreshToken = "";
            conn.EncryptedStepHistoryJson = await kms.EncryptAsync("[]", ct);
            conn.Revision++;
            await db.SaveChangesAsync(ct);
            MemoryCache.TryRemove(userId, out _);
            return new GoogleHealthSyncResult("reconnect_required", conn.ConnectedAt, conn.LastSyncedAt, "unavailable", [], "credentials_revoked", "Google Health authorization was revoked. Please reconnect.");
        }

        if (string.IsNullOrEmpty(accessToken))
        {
            return await ReturnStaleOrUnavailable(conn, "refresh_error", refreshError ?? "Failed to refresh Google Health access token.", ct);
        }

        // Query Google Health steps dailyRollUp for today + preceding 30 calendar days (31 days)
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == userId, ct);
        var today = RetentionService.Today(user.ProfileJson);
        var start = today.AddDays(-30);
        var endPlusOne = today.AddDays(1);

        try
        {
            var dayMap = await FetchDailyRollupStepsAsync(accessToken, start, endPlusOne, ct);

            // Construct 31 calendar days in ascending order
            var days = new List<GoogleHealthDay>(31);
            for (var d = start; d <= today; d = d.AddDays(1))
            {
                var count = dayMap.TryGetValue(d, out var val) ? val : null;
                days.Add(new GoogleHealthDay(d, count));
            }

            var daysJson = JsonSerializer.Serialize(days);
            conn.EncryptedStepHistoryJson = await kms.EncryptAsync(daysJson, ct);
            conn.LastSyncedAt = DateTime.UtcNow;
            conn.Revision++;
            await db.SaveChangesAsync(ct);

            return new GoogleHealthSyncResult("connected", conn.ConnectedAt, conn.LastSyncedAt, "fresh", days);
        }
        catch (GoogleHealthRequestException ex)
        {
            return await ReturnGoogleHealthFailure(conn, ex, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return await ReturnStaleOrUnavailable(conn, "sync_network_error", "Could not refresh steps from Google Health.", ct);
        }
    }

    private async Task<GoogleHealthSyncResult> ReturnGoogleHealthFailure(GoogleHealthConnection conn, GoogleHealthRequestException failure, CancellationToken ct)
    {
        var (warningCode, warningMessage) = string.Equals(failure.ProviderReason, "ACCOUNT_NOT_LINKED", StringComparison.OrdinalIgnoreCase)
            ? ("account_not_linked", "Google Health could not find a Fitbit account linked to this Google account. Open Fitbit, choose Continue with Google, and sync your device before retrying.")
            : failure.StatusCode switch
        {
            HttpStatusCode.NotFound => ("provider_resource_not_found", "Google Health could not find this account's health data. Open Google Health or Fitbit, sync a device, then try again."),
            HttpStatusCode.BadRequest => ("provider_request_rejected", "Google Health rejected the step request. Check that the Google Health API and activity-and-fitness read permission are configured for this app, then retry."),
            HttpStatusCode.Unauthorized => ("credentials_revoked", "Google Health rejected the saved authorization. Reconnect Google Health to continue."),
            HttpStatusCode.Forbidden => ("permissions_missing", "Google Health did not grant permission to read steps. Reconnect and allow the activity permission."),
            HttpStatusCode.TooManyRequests or HttpStatusCode.BadGateway or HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout => ("provider_unavailable", "Google Health is temporarily unavailable. Try syncing again in a moment."),
            _ => ("sync_network_error", "Could not refresh steps from Google Health. Try syncing again.")
        };
        var correlationId = Guid.NewGuid().ToString("N")[..12];
        logger?.LogWarning("Google Health sync failed at {Stage}; status {StatusCode}; provider reason {ProviderReason}; code {Code}; correlation {CorrelationId}.",
            failure.Stage, (int)failure.StatusCode, failure.ProviderReason ?? "unknown", warningCode, correlationId);
        return await ReturnStaleOrUnavailable(conn, warningCode, warningMessage, ct);
    }

    private async Task<GoogleHealthSyncResult> ReturnStaleOrUnavailable(GoogleHealthConnection conn, string warningCode, string warningMessage, CancellationToken ct)
    {
        try
        {
            if (!string.IsNullOrEmpty(conn.EncryptedStepHistoryJson))
            {
                var cachedDays = await DecryptDaysAsync(conn.EncryptedStepHistoryJson, ct);
                if (cachedDays.Count > 0)
                    return new GoogleHealthSyncResult("connected", conn.ConnectedAt, conn.LastSyncedAt, "stale", cachedDays, warningCode, warningMessage);
            }
        }
        catch
        {
            // Ignore decryption failure on fallback
        }

        return new GoogleHealthSyncResult("connected", conn.ConnectedAt, conn.LastSyncedAt, "unavailable", [], warningCode, warningMessage);
    }

    private async Task<IReadOnlyList<GoogleHealthDay>> DecryptDaysAsync(string encryptedJson, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(encryptedJson)) return [];
        var json = await kms.DecryptAsync(encryptedJson, ct);
        if (string.IsNullOrEmpty(json) || json == "[]") return [];
        return JsonSerializer.Deserialize<List<GoogleHealthDay>>(json) ?? [];
    }

    private async Task<string?> ResolveGoogleIdentityAsync(string accessToken, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, "https://openidconnect.googleapis.com/v1/userinfo");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        try
        {
            using var res = await http.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) return null;

            var json = await res.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("sub", out var subProp))
                return subProp.GetString();
        }
        catch
        {
            return null;
        }

        return null;
    }

    private async Task<(string? AccessToken, bool IsRevoked, string? Error)> RefreshAccessTokenAsync(string refreshToken, CancellationToken ct)
    {
        var body = new Dictionary<string, string>
        {
            ["client_id"] = ClientId,
            ["client_secret"] = ClientSecret,
            ["refresh_token"] = refreshToken,
            ["grant_type"] = "refresh_token"
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token")
        {
            Content = new FormUrlEncodedContent(body)
        };

        using var res = await http.SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);

        if (!res.IsSuccessStatusCode)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("error", out var errProp))
                {
                    var err = errProp.GetString();
                    if (err is "invalid_grant" or "unauthorized_client")
                        return (null, true, err);
                }
            }
            catch { }

            return (null, false, $"Status {res.StatusCode}");
        }

        using var successDoc = JsonDocument.Parse(json);
        var accessToken = successDoc.RootElement.TryGetProperty("access_token", out var atProp) ? atProp.GetString() : null;
        return (accessToken, false, null);
    }

    private async Task<Dictionary<DateOnly, int?>> FetchDailyRollupStepsAsync(string accessToken, DateOnly start, DateOnly endPlusOne, CancellationToken ct)
    {
        // The access token identifies the Google Health user. Using `me` avoids an
        // extra identity request, which can fail for accounts that have not migrated
        // a legacy Fitbit identity even though their step data is readable.
        var url = "https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp";
        var requestPayload = new
        {
            range = new
            {
                start = new
                {
                    date = new { year = start.Year, month = start.Month, day = start.Day },
                    time = new { hours = 0, minutes = 0, seconds = 0, nanos = 0 }
                },
                end = new
                {
                    date = new { year = endPlusOne.Year, month = endPlusOne.Month, day = endPlusOne.Day },
                    time = new { hours = 0, minutes = 0, seconds = 0, nanos = 0 }
                }
            },
            windowSizeDays = 1,
            dataSourceFamily = GoogleSourcesDataSourceFamily
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(requestPayload), Encoding.UTF8, "application/json")
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            var responseBody = await res.Content.ReadAsStringAsync(ct);
            throw new GoogleHealthRequestException("daily_rollup", res.StatusCode, ExtractProviderReason(responseBody));
        }

        var json = await res.Content.ReadAsStringAsync(ct);
        return ParseDailyRollupResponse(json);
    }

    private static string? ExtractProviderReason(string responseBody)
    {
        if (string.IsNullOrWhiteSpace(responseBody)) return null;

        try
        {
            using var doc = JsonDocument.Parse(responseBody);
            var root = doc.RootElement;
            if (!root.TryGetProperty("error", out var error) || error.ValueKind != JsonValueKind.Object)
                return null;

            if (error.TryGetProperty("details", out var details) && details.ValueKind == JsonValueKind.Array)
            {
                foreach (var detail in details.EnumerateArray())
                {
                    if (detail.ValueKind == JsonValueKind.Object
                        && detail.TryGetProperty("reason", out var reason)
                        && reason.ValueKind == JsonValueKind.String
                        && !string.IsNullOrWhiteSpace(reason.GetString()))
                        return NormalizeProviderReason(reason.GetString());
                }
            }

            if (error.TryGetProperty("reason", out var directReason)
                && directReason.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(directReason.GetString()))
                return NormalizeProviderReason(directReason.GetString());

            if (error.TryGetProperty("status", out var status)
                && status.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(status.GetString()))
                return NormalizeProviderReason(status.GetString());
        }
        catch (JsonException)
        {
            // Provider error bodies are diagnostic only; a malformed body must not
            // prevent the normal stale/unavailable fallback.
        }

        return null;
    }

    private static string? NormalizeProviderReason(string? reason)
        => !string.IsNullOrWhiteSpace(reason)
            && reason.Length <= 80
            && reason.All(ch => char.IsLetterOrDigit(ch) || ch is '_' or '-' or '.')
            ? reason
            : null;

    public static Dictionary<DateOnly, int?> ParseDailyRollupResponse(string json)
    {
        var map = new Dictionary<DateOnly, int?>();
        if (string.IsNullOrWhiteSpace(json)) return map;

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        JsonElement list = default;
        if (root.TryGetProperty("dataPoints", out var dp) && dp.ValueKind == JsonValueKind.Array)
            list = dp;
        else if (root.TryGetProperty("dailyRollups", out var dr) && dr.ValueKind == JsonValueKind.Array)
            list = dr;
        else if (root.TryGetProperty("rollupDataPoints", out var rdp) && rdp.ValueKind == JsonValueKind.Array)
            list = rdp;
        else if (root.ValueKind == JsonValueKind.Array)
            list = root;

        if (list.ValueKind != JsonValueKind.Array) return map;

        foreach (var item in list.EnumerateArray())
        {
            var date = ExtractDate(item);
            if (!date.HasValue) continue;

            var count = ExtractCount(item);
            map[date.Value] = count;
        }

        return map;
    }

    private static DateOnly? ExtractDate(JsonElement item)
    {
        JsonElement timeEl = default;
        if (item.TryGetProperty("civilStartTime", out var cst)) timeEl = cst;
        else if (item.TryGetProperty("civil_start_time", out var cst2)) timeEl = cst2;
        else if (item.TryGetProperty("startTime", out var st)) timeEl = st;
        else if (item.TryGetProperty("interval", out var intEl) && intEl.TryGetProperty("civilStartTime", out var cst3)) timeEl = cst3;

        if (timeEl.ValueKind == JsonValueKind.Object)
        {
            if (timeEl.TryGetProperty("date", out var dObj) && dObj.ValueKind == JsonValueKind.Object)
            {
                if (dObj.TryGetProperty("year", out var y) && dObj.TryGetProperty("month", out var m) && dObj.TryGetProperty("day", out var d))
                {
                    return new DateOnly(y.GetInt32(), m.GetInt32(), d.GetInt32());
                }
            }
        }
        else if (timeEl.ValueKind == JsonValueKind.String)
        {
            var str = timeEl.GetString();
            if (!string.IsNullOrEmpty(str))
            {
                if (DateOnly.TryParse(str[..Math.Min(10, str.Length)], out var parsedDate))
                    return parsedDate;
                if (DateTime.TryParse(str, out var parsedDt))
                    return DateOnly.FromDateTime(parsedDt);
            }
        }

        if (item.TryGetProperty("date", out var directDate) && directDate.ValueKind == JsonValueKind.String)
        {
            if (DateOnly.TryParse(directDate.GetString(), out var parsedDate))
                return parsedDate;
        }

        return null;
    }

    private static int? ExtractCount(JsonElement item)
    {
        JsonElement stepsObj = default;
        if (item.TryGetProperty("steps", out var s)) stepsObj = s;
        else if (item.TryGetProperty("stepsRollupValue", out var srv)) stepsObj = srv;
        else if (item.TryGetProperty("steps_rollup_value", out var srv2)) stepsObj = srv2;

        if (stepsObj.ValueKind == JsonValueKind.Object)
        {
            if (stepsObj.TryGetProperty("countSum", out var cs) || stepsObj.TryGetProperty("count_sum", out cs))
            {
                return ParseCountElement(cs);
            }
            if (stepsObj.TryGetProperty("count", out var c))
            {
                return ParseCountElement(c);
            }
        }

        if (item.TryGetProperty("countSum", out var directCs) || item.TryGetProperty("count_sum", out directCs))
        {
            return ParseCountElement(directCs);
        }

        if (item.TryGetProperty("count", out var directC))
        {
            return ParseCountElement(directC);
        }

        return null;
    }

    private static int? ParseCountElement(JsonElement el)
    {
        if (el.ValueKind == JsonValueKind.String && int.TryParse(el.GetString(), out var countStr))
            return countStr;
        if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var countNum))
            return countNum;
        return null;
    }
}
