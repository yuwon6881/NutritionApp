using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

/// Issues short-lived access tokens against durable Fitness Account consent. The local connection
/// identifier is not a bearer credential and never leaves this server.
public sealed class IntegrationTokenService(
    AppDb db,
    IHttpClientFactory clients,
    IConfiguration config,
    ISharedAccessTokenValidator tokens,
    IGoogleHealthKms kms,
    ILogger<IntegrationTokenService>? logger = null)
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> ExchangeGates = new(StringComparer.Ordinal);
    private static readonly MemoryCache AccessTokens = new(new MemoryCacheOptions { SizeLimit = 512 });
    private static readonly TimeSpan TokenTimeout = TimeSpan.FromSeconds(10);

    public async Task<string?> Unprotect(string encrypted, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(encrypted)) return null;
        try { return await kms.DecryptAsync(encrypted, ct); }
        catch (CryptographicException) { return null; }
        catch (FormatException) { return null; }
        catch (InvalidOperationException) { return null; }
        catch (DomainException) { return null; }
    }

    public async Task<string?> AccessToken(string peer, string requiredScope, CancellationToken ct)
    {
        var userId = db.CurrentUser;
        if (userId is null) return null;
        var key = $"{userId.Value:N}:{peer}:{requiredScope}";
        var grantSnapshot = await db.IntegrationGrants.AsNoTracking()
            .SingleOrDefaultAsync(x => x.Peer == peer && x.Status == "active", ct);
        if (grantSnapshot is null || grantSnapshot.CentralConnectionId is null || grantSnapshot.CentralGeneration is null)
        {
            AccessTokens.Remove(key);
            return null;
        }
        if (AccessTokens.TryGetValue(key, out var cachedValue) && cachedValue is CachedAccessToken cached
            && cached.GrantRevision == grantSnapshot.Revision
            && cached.ConnectionGeneration == grantSnapshot.CentralGeneration
            && cached.ExpiresAt > DateTime.UtcNow.AddSeconds(30))
            return cached.Value;

        var gate = ExchangeGates.GetOrAdd(key, static _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            var grant = await db.IntegrationGrants.AsNoTracking()
                .SingleOrDefaultAsync(x => x.Peer == peer && x.Status == "active", ct);
            if (grant?.CentralConnectionId is not { } connectionId || grant.CentralGeneration is not { } generation)
            {
                AccessTokens.Remove(key);
                return null;
            }
            if (AccessTokens.TryGetValue(key, out cachedValue) && cachedValue is CachedAccessToken cachedAfterGate
                && cachedAfterGate.GrantRevision == grant.Revision
                && cachedAfterGate.ConnectionGeneration == generation
                && cachedAfterGate.ExpiresAt > DateTime.UtcNow.AddSeconds(30))
                return cachedAfterGate.Value;

            var identitySubject = await db.Users.Where(x => x.Id == userId.Value)
                .Select(x => x.IdentitySubject).SingleOrDefaultAsync(ct);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TokenTimeout);
            try
            {
                var settings = GetCentralClientSettings();
                using var request = BasicRequest(HttpMethod.Post, $"{settings.Authority.TrimEnd('/')}/connect/token", settings);
                request.Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "fitness_connection",
                    ["connection_id"] = connectionId.ToString("D")
                });
                using var response = await clients.CreateClient("fitness-account").SendAsync(request, timeout.Token);
                var responseBody = await response.Content.ReadAsStringAsync(timeout.Token);
                if (!response.IsSuccessStatusCode)
                {
                    logger?.LogWarning("Durable peer token exchange failed for {Peer} with status {StatusCode}.", peer, (int)response.StatusCode);
                    await RefreshOwnerStatus(peer, grant, key, ct);
                    return null;
                }

                using var document = JsonDocument.Parse(responseBody);
                var access = document.RootElement.TryGetProperty("access_token", out var accessElement) ? accessElement.GetString() : null;
                var expiresIn = document.RootElement.TryGetProperty("expires_in", out var expiresElement)
                    && expiresElement.TryGetInt32(out var seconds) ? seconds : 0;
                if (string.IsNullOrWhiteSpace(access) || expiresIn <= 30) return null;
                var validated = await tokens.RequireAccessToken(access, requiredScope, timeout.Token);
                Validation.Require(string.Equals(validated.Subject, identitySubject, StringComparison.Ordinal),
                    "The peer token belongs to a different account.", 403);
                Validation.Require(validated.ConnectionId == connectionId && validated.ConnectionGeneration == generation,
                    "The peer token does not match the active connection.", 401);

                AccessTokens.Set(key, new CachedAccessToken(access, grant.Revision, generation,
                    DateTime.UtcNow.AddSeconds(expiresIn)), new MemoryCacheEntryOptions
                {
                    Size = 1,
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(Math.Max(1, expiresIn - 30))
                });
                return access;
            }
            catch (DomainException ex)
            {
                logger?.LogWarning("Durable peer token exchange is temporarily unavailable for {Peer}: {Category}.", peer, ex.Status);
                return null;
            }
            catch (HttpRequestException)
            {
                return null;
            }
            catch (JsonException)
            {
                return null;
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                return null;
            }
        }
        finally { gate.Release(); }
    }

    public async Task<string> GetConnectionState(string peer, CancellationToken ct)
    {
        var grant = await db.IntegrationGrants.AsNoTracking().SingleOrDefaultAsync(x => x.Peer == peer, ct);
        if (grant is null || grant.Status == "revoked") return "disconnected";
        if (grant.Status == "reconnect_required") return "reconnect_required";
        if (grant.Status != "active") return "disconnected";
        if (grant.CentralConnectionId is null || grant.CentralGeneration is null) return "upgrade_required";

        try
        {
            var status = await ReadOwnerStatus(grant.CentralConnectionId.Value, ct);
            if (status is null) return "temporary_unavailable";
            if (status.Value.Status == "active" && status.Value.Generation == grant.CentralGeneration.Value)
                return "connected";
            await MarkReconnectRequired(peer, grant.CentralConnectionId.Value, grant.Revision, ct);
            return "reconnect_required";
        }
        catch (Exception ex) when (ex is HttpRequestException or DomainException or JsonException or OperationCanceledException)
        {
            if (ex is OperationCanceledException && ct.IsCancellationRequested) throw;
            logger?.LogWarning("Fitness Account connection status is temporarily unavailable for {Peer}.", peer);
            return "temporary_unavailable";
        }
    }

    /// Every incoming request validates the central connection generation. This intentionally has
    /// no positive cache, so central revocation takes effect on the next shared-data request.
    public async Task ValidateIncomingConnection(ValidatedAccessToken token, CancellationToken ct)
    {
        if (token.ConnectionId is not { } connectionId || token.ConnectionGeneration is not { } generation)
            throw new DomainException("The shared access token has no active connection reference.", 403);
        try
        {
            var settings = GetCentralClientSettings();
            using var request = BasicRequest(HttpMethod.Get,
                $"{settings.Authority.TrimEnd('/')}/internal/integrations/connections/{connectionId:D}/validate?generation={generation}", settings);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TokenTimeout);
            using var response = await clients.CreateClient("fitness-account").SendAsync(request, timeout.Token);
            if (response.StatusCode == HttpStatusCode.Gone)
                throw new DomainException("The shared Fitness Account connection is no longer active.", 403);
            if (!response.IsSuccessStatusCode)
                throw new DomainException("Shared training is temporarily unavailable.", 503);
            var payload = await response.Content.ReadFromJsonAsync<ConnectionValidation>(cancellationToken: timeout.Token);
            Validation.Require(payload?.Active == true && payload.Generation == generation,
                "The shared Fitness Account connection is no longer active.", 403);
        }
        catch (DomainException) { throw; }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or OperationCanceledException or InvalidOperationException)
        {
            logger?.LogWarning("Fitness Account could not validate an incoming training connection.");
            throw new DomainException("Shared training is temporarily unavailable.", 503);
        }
    }

    /// Revokes centrally before changing local state. A transient error leaves the grant and cache
    /// untouched so the user can retry without seeing a false success.
    public async Task RevokeAndPurge(string peer, CancellationToken ct)
    {
        var grant = await db.IntegrationGrants.SingleOrDefaultAsync(x => x.Peer == peer, ct);
        if (grant is null || grant.Status == "revoked") return;

        if (grant.CentralConnectionId is { } connectionId)
        {
            var settings = GetCentralClientSettings();
            using var request = BasicRequest(HttpMethod.Post,
                $"{settings.Authority.TrimEnd('/')}/internal/integrations/connections/{connectionId:D}/revoke", settings);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TokenTimeout);
            using var response = await clients.CreateClient("fitness-account").SendAsync(request, timeout.Token);
            if (response.StatusCode != HttpStatusCode.NoContent)
                throw new DomainException("Could not confirm Workout disconnection. Try again.", 503);
        }
        else if (!string.IsNullOrWhiteSpace(grant.EncryptedRefreshToken))
        {
            await RevokeLegacyToken(grant.EncryptedRefreshToken, ct);
        }
        else
        {
            throw new DomainException("Could not confirm Workout disconnection. Reconnect the older connection and try again.", 503);
        }

        grant.Status = "revoked";
        grant.RevokedAt = DateTime.UtcNow;
        grant.EncryptedRefreshToken = "";
        grant.Revision++;
        await db.SaveChangesAsync(ct);
        AccessTokens.Remove($"{grant.UserId:N}:{peer}:workout.training_summary.read");
    }

    private async Task RevokeLegacyToken(string encryptedRefresh, CancellationToken ct)
    {
        var refresh = await Unprotect(encryptedRefresh, ct);
        if (string.IsNullOrWhiteSpace(refresh))
            throw new DomainException("Could not confirm Workout disconnection. Try again.", 503);
        var settings = GetCentralClientSettings();
        using var request = BasicRequest(HttpMethod.Post, $"{settings.Authority.TrimEnd('/')}/connect/revocation", settings);
        request.Content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["token"] = refresh,
            ["token_type_hint"] = "refresh_token"
        });
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TokenTimeout);
        using var response = await clients.CreateClient("fitness-account").SendAsync(request, timeout.Token);
        if (!response.IsSuccessStatusCode)
            throw new DomainException("Could not confirm Workout disconnection. Try again.", 503);
    }

    private async Task RefreshOwnerStatus(string peer, IntegrationGrant grant, string cacheKey, CancellationToken ct)
    {
        if (grant.CentralConnectionId is not { } id) return;
        try
        {
            var status = await ReadOwnerStatus(id, ct);
            if (status is null || status.Value.Status == "active" && status.Value.Generation == grant.CentralGeneration) return;
            await MarkReconnectRequired(peer, id, grant.Revision, ct);
            AccessTokens.Remove(cacheKey);
        }
        catch (Exception ex) when (ex is HttpRequestException or DomainException or JsonException or OperationCanceledException)
        {
            if (ex is OperationCanceledException && ct.IsCancellationRequested) throw;
            // The exchange failure remains temporary when ownership status cannot be checked.
        }
    }

    private async Task<(string Status, long Generation)?> ReadOwnerStatus(Guid connectionId, CancellationToken ct)
    {
        var settings = GetCentralClientSettings();
        using var request = BasicRequest(HttpMethod.Get,
            $"{settings.Authority.TrimEnd('/')}/internal/integrations/connections/{connectionId:D}", settings);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TokenTimeout);
        using var response = await clients.CreateClient("fitness-account").SendAsync(request, timeout.Token);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        if (!response.IsSuccessStatusCode) return null;
        var payload = await response.Content.ReadFromJsonAsync<ConnectionStatus>(cancellationToken: timeout.Token);
        return payload is null ? null : (payload.Status, payload.Generation);
    }

    private async Task MarkReconnectRequired(string peer, Guid connectionId, long revision, CancellationToken ct)
    {
        var current = await db.IntegrationGrants.SingleOrDefaultAsync(x => x.Peer == peer, ct);
        if (current is null || current.Revision != revision || current.CentralConnectionId != connectionId || current.Status != "active") return;
        current.Status = "reconnect_required";
        current.RevokedAt = DateTime.UtcNow;
        current.EncryptedRefreshToken = "";
        current.Revision++;
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { db.ChangeTracker.Clear(); }
    }

    private static HttpRequestMessage BasicRequest(HttpMethod method, string uri, CentralClientSettings settings)
    {
        var request = new HttpRequestMessage(method, uri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
            Convert.ToBase64String(Encoding.UTF8.GetBytes($"{settings.ClientId}:{settings.ClientSecret}")));
        return request;
    }

    private CentralClientSettings GetCentralClientSettings()
    {
        var authority = config["Identity:Authority"];
        var clientId = config["Identity:ClientId"];
        var clientSecret = config["Identity:ClientSecret"];
        Validation.Require(!string.IsNullOrWhiteSpace(authority) && !string.IsNullOrWhiteSpace(clientId)
            && !string.IsNullOrWhiteSpace(clientSecret), "Fitness Account integration is not configured.", 503);
        return new(authority!, clientId!, clientSecret!);
    }

    private sealed record CentralClientSettings(string Authority, string ClientId, string ClientSecret);
    private sealed record ConnectionStatus(string Status, long Generation);
    private sealed record ConnectionValidation(bool Active, long Generation);
    private sealed record CachedAccessToken(string Value, long GrantRevision, long ConnectionGeneration, DateTime ExpiresAt);
}
