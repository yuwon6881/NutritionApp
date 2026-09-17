using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

/// Keeps peer refresh tokens backend-only. Access tokens are minted just in time, validated for
/// the peer audience, and never returned to the PWA.
public sealed class IntegrationTokenService(
    AppDb db,
    IHttpClientFactory clients,
    IConfiguration config,
    ISharedAccessTokenValidator tokens,
    IGoogleHealthKms kms,
    ILogger<IntegrationTokenService>? logger = null)
{
    private static readonly SemaphoreSlim RotationGate = new(1, 1);
    private const int MaxRefreshAttempts = 3;

    public Task<string> Protect(string value, CancellationToken ct = default) => kms.EncryptAsync(value, ct);

    public async Task<string?> Unprotect(string encrypted, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(encrypted)) return null;
        try
        {
            return await kms.DecryptAsync(encrypted, ct);
        }
        catch (CryptographicException) { return null; }
        catch (FormatException) { return null; }
        catch (InvalidOperationException) { return null; }
        catch (DomainException) { return null; }
    }

    public async Task<string?> AccessToken(string peer, string requiredScope, CancellationToken ct)
    {
        await RotationGate.WaitAsync(ct);
        try
        {
            for (var attempt = 0; attempt < MaxRefreshAttempts; attempt++)
            {
                // Use a no-tracking snapshot. A separate Cloud Run revision may have
                // rotated the grant since this request began, and a tracked stale row
                // must never overwrite that newer refresh token.
                var grant = await db.IntegrationGrants.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.Peer == peer && x.Status == "active", ct);
                var refresh = grant is null ? null : await Unprotect(grant.EncryptedRefreshToken, ct);
                if (grant is null || string.IsNullOrWhiteSpace(refresh)) return null;

                var identitySubject = await db.Users.Where(x => x.Id == db.CurrentUser)
                    .Select(x => x.IdentitySubject).SingleOrDefaultAsync(ct);
                var settings = GetCentralClientSettings();
                using var request = new HttpRequestMessage(HttpMethod.Post, $"{settings.Authority.TrimEnd('/')}/connect/token");
                request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{settings.ClientId}:{settings.ClientSecret}")));
                request.Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "refresh_token",
                    ["refresh_token"] = refresh
                });
                using var response = await clients.CreateClient("fitness-account").SendAsync(request, ct);
                var responseBody = await response.Content.ReadAsStringAsync(ct);
                if (!response.IsSuccessStatusCode)
                {
                    var invalidGrant = IsInvalidGrant(response.StatusCode, responseBody);
                    logger?.LogWarning("Peer token refresh failed for {Peer} with status {StatusCode}; invalidGrant={InvalidGrant}; attempt={Attempt}.",
                        peer, (int)response.StatusCode, invalidGrant, attempt + 1);
                    if (!invalidGrant) return null;

                    // A rotating provider invalidates the old token as soon as another
                    // revision redeems it. Reload before revoking: if the row changed,
                    // retry with the token that the other revision persisted.
                    var latest = await db.IntegrationGrants.SingleOrDefaultAsync(x => x.Peer == peer, ct);
                    if (latest is null || latest.Status != "active") return null;
                    if (latest.Revision != grant.Revision
                        || !string.Equals(latest.EncryptedRefreshToken, grant.EncryptedRefreshToken, StringComparison.Ordinal))
                    {
                        db.ChangeTracker.Clear();
                        continue;
                    }

                    latest.Status = "revoked";
                    latest.RevokedAt = DateTime.UtcNow;
                    latest.EncryptedRefreshToken = "";
                    latest.Revision++;
                    try
                    {
                        await db.SaveChangesAsync(ct);
                    }
                    catch (DbUpdateConcurrencyException)
                    {
                        // Another revision won the update between the reload and the
                        // revoke. Retry so its active token is not lost.
                        db.ChangeTracker.Clear();
                        continue;
                    }
                    return null;
                }

                using var document = JsonDocument.Parse(responseBody);
                var access = document.RootElement.TryGetProperty("access_token", out var accessElement) ? accessElement.GetString() : null;
                if (string.IsNullOrWhiteSpace(access)) return null;
                var validated = await tokens.RequireAccessToken(access, requiredScope, ct);
                Validation.Require(string.Equals(validated.Subject, identitySubject, StringComparison.Ordinal), "The peer token belongs to a different account.", 403);
                if (document.RootElement.TryGetProperty("refresh_token", out var nextRefresh) && !string.IsNullOrWhiteSpace(nextRefresh.GetString()))
                {
                    var encryptedNextRefresh = await Protect(nextRefresh.GetString()!, ct);
                    var latest = await db.IntegrationGrants.SingleOrDefaultAsync(x => x.Peer == peer, ct);
                    if (latest is not null
                        && latest.Status == "active"
                        && latest.Revision == grant.Revision
                        && string.Equals(latest.EncryptedRefreshToken, grant.EncryptedRefreshToken, StringComparison.Ordinal))
                    {
                        latest.EncryptedRefreshToken = encryptedNextRefresh;
                        latest.Revision++;
                        try
                        {
                            await db.SaveChangesAsync(ct);
                        }
                        catch (DbUpdateConcurrencyException)
                        {
                            // The access token is already valid. Keep the newer token
                            // written by the competing revision and do not overwrite it.
                            db.ChangeTracker.Clear();
                        }
                    }
                }
                return access;
            }
            return null;
        }
        catch (DomainException) { return null; }
        catch (HttpRequestException) { return null; }
        catch (JsonException) { return null; }
        finally { RotationGate.Release(); }
    }

    private static bool IsInvalidGrant(HttpStatusCode status, string responseBody)
    {
        if (status != HttpStatusCode.BadRequest || string.IsNullOrWhiteSpace(responseBody)) return false;
        try
        {
            using var document = JsonDocument.Parse(responseBody);
            return document.RootElement.TryGetProperty("error", out var error)
                && error.ValueKind == JsonValueKind.String
                && string.Equals(error.GetString(), "invalid_grant", StringComparison.OrdinalIgnoreCase);
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public async Task RevokeAndPurge(string peer, CancellationToken ct)
    {
        var grant = await db.IntegrationGrants.SingleOrDefaultAsync(x => x.Peer == peer, ct);
        if (grant is null) return;
        var refresh = await Unprotect(grant.EncryptedRefreshToken, ct);
        if (!string.IsNullOrWhiteSpace(refresh))
        {
            try
            {
                var settings = GetCentralClientSettings();
                using var request = new HttpRequestMessage(HttpMethod.Post, $"{settings.Authority.TrimEnd('/')}/connect/revocation");
                request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{settings.ClientId}:{settings.ClientSecret}")));
                request.Content = new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = refresh, ["token_type_hint"] = "refresh_token" });
                await clients.CreateClient("fitness-account").SendAsync(request, ct);
            }
            catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or DomainException) { /* local purge still stops all future exchange */ }
        }
        db.IntegrationGrants.Remove(grant);
        await db.SaveChangesAsync(ct);
    }

    private CentralClientSettings GetCentralClientSettings()
    {
        var authority = config["Identity:Authority"];
        var clientId = config["Identity:ClientId"];
        var clientSecret = config["Identity:ClientSecret"];
        Validation.Require(!string.IsNullOrWhiteSpace(authority) && !string.IsNullOrWhiteSpace(clientId) && !string.IsNullOrWhiteSpace(clientSecret), "Fitness Account integration is not configured.", 503);
        return new(authority!, clientId!, clientSecret!);
    }

    private sealed record CentralClientSettings(string Authority, string ClientId, string ClientSecret);
}
