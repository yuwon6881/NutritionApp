using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
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
    string? WarningMessage = null
);

public sealed record GoogleHealthConnectResult(string AuthUrl);

public class GoogleHealthService(HttpClient http, AppDb db, IGoogleHealthKms kms, IConfiguration config)
{
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

    public async Task<GoogleHealthConnectResult> GenerateConnectUrlAsync(Guid userId, string sessionHash, string? requestOrigin, CancellationToken ct)
    {
        Validation.Require(!string.IsNullOrEmpty(ClientId), "Google Health integration is not configured.", 503);

        var stateNonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var callbackUrl = GetCallbackUrl(requestOrigin);

        var oauthState = new GoogleHealthOAuthState
        {
            State = stateNonce,
            UserId = userId,
            SessionHash = sessionHash,
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
            ["scope"] = Scope,
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
        if (!string.IsNullOrEmpty(error))
            return $"/settings?google_health=error&code={Uri.EscapeDataString(error)}";

        if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
            return "/settings?google_health=error&code=missing_parameters";

        // Validate state nonce
        var oauthState = await db.GoogleHealthOAuthStates.IgnoreQueryFilters().SingleOrDefaultAsync(s => s.State == state, ct);
        if (oauthState == null || oauthState.ExpiresAt < DateTime.UtcNow)
        {
            if (oauthState != null)
            {
                db.GoogleHealthOAuthStates.Remove(oauthState);
                await db.SaveChangesAsync(ct);
            }
            return "/settings?google_health=error&code=invalid_state";
        }

        if (oauthState.UserId != userId || oauthState.SessionHash != sessionHash)
        {
            db.GoogleHealthOAuthStates.Remove(oauthState);
            await db.SaveChangesAsync(ct);
            return "/settings?google_health=error&code=session_mismatch";
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

        using var tokenRes = await http.SendAsync(tokenReq, ct);
        if (!tokenRes.IsSuccessStatusCode)
            return "/settings?google_health=error&code=token_exchange_failed";

        var tokenJson = await tokenRes.Content.ReadAsStringAsync(ct);
        using var tokenDoc = JsonDocument.Parse(tokenJson);
        var root = tokenDoc.RootElement;

        var accessToken = root.TryGetProperty("access_token", out var atProp) ? atProp.GetString() : null;
        var refreshToken = root.TryGetProperty("refresh_token", out var rtProp) ? rtProp.GetString() : null;

        if (string.IsNullOrEmpty(accessToken) || string.IsNullOrEmpty(refreshToken))
            return "/settings?google_health=error&code=missing_tokens";

        // Resolve Google Identity (sub)
        var googleId = await ResolveGoogleIdentityAsync(accessToken, ct);
        if (string.IsNullOrEmpty(googleId))
            return "/settings?google_health=error&code=identity_resolution_failed";

        var googleIdHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(googleId))).ToLowerInvariant();

        // Enforce one Google Health identity per Nutrition account across all tenants
        var duplicate = await db.GoogleHealthConnections.IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.GoogleIdHash == googleIdHash && c.UserId != userId, ct);
        if (duplicate != null)
            return "/settings?google_health=error&code=duplicate_account";

        // Encrypt with KMS
        var encryptedGoogleId = await kms.EncryptAsync(googleId, ct);
        var encryptedRefreshToken = await kms.EncryptAsync(refreshToken, ct);
        var emptyHistory = await kms.EncryptAsync("[]", ct);

        var existingConn = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (existingConn != null)
        {
            existingConn.GoogleIdHash = googleIdHash;
            existingConn.EncryptedGoogleId = encryptedGoogleId;
            existingConn.EncryptedRefreshToken = encryptedRefreshToken;
            existingConn.EncryptedStepHistoryJson = emptyHistory;
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

        db.GoogleHealthConnections.Remove(conn);
        await db.SaveChangesAsync(ct);
        MemoryCache.TryRemove(userId, out _);

        return new GoogleHealthSyncResult("disconnected", null, null, "unavailable", []);
    }

    public async Task<GoogleHealthSyncResult> SyncAsync(Guid userId, CancellationToken ct)
    {
        // Check 2-minute memory cache
        if (MemoryCache.TryGetValue(userId, out var cached) && (DateTime.UtcNow - cached.SyncedAt) < TimeSpan.FromMinutes(2))
        {
            return cached.Result;
        }

        // Coalesce concurrent calls for the same user
        while (true)
        {
            if (InFlightSyncs.TryGetValue(userId, out var existingTask))
            {
                try
                {
                    return await existingTask;
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
                    var result = await PerformSyncAsync(userId, ct);
                    if (result.Status == "connected" && result.Freshness == "fresh")
                    {
                        MemoryCache[userId] = (DateTime.UtcNow, result);
                    }
                    tcs.SetResult(result);
                    return result;
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

    private async Task<GoogleHealthSyncResult> PerformSyncAsync(Guid userId, CancellationToken ct)
    {
        var conn = await db.GoogleHealthConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (conn == null)
            return new GoogleHealthSyncResult("disconnected", null, null, "unavailable", []);

        if (conn.Status == "reconnect_required")
            return new GoogleHealthSyncResult("reconnect_required", conn.ConnectedAt, conn.LastSyncedAt, "unavailable", [], "credentials_revoked", "Google Health authorization was revoked. Please reconnect.");

        // Check if DB record has recent sync within 2 minutes
        if (conn.LastSyncedAt.HasValue && (DateTime.UtcNow - conn.LastSyncedAt.Value) < TimeSpan.FromMinutes(2))
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
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return await ReturnStaleOrUnavailable(conn, "sync_network_error", "Could not refresh steps from Google Health.", ct);
        }
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
        using var req = new HttpRequestMessage(HttpMethod.Get, $"https://oauth2.googleapis.com/tokeninfo?access_token={Uri.EscapeDataString(accessToken)}");
        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;

        var json = await res.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.TryGetProperty("sub", out var subProp))
            return subProp.GetString();
        if (doc.RootElement.TryGetProperty("user_id", out var uidProp))
            return uidProp.GetString();

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
            }
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(requestPayload), Encoding.UTF8, "application/json")
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
            throw new DomainException($"Google Health dailyRollUp returned {res.StatusCode}.", (int)res.StatusCode);

        var json = await res.Content.ReadAsStringAsync(ct);
        return ParseDailyRollupResponse(json);
    }

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
