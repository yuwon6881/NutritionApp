using System.Security.Cryptography;
using System.Text;
using Google.Apis.Auth;

namespace Nutrition.Api.Services;

/// Returns the verified email of a Google-signed OIDC identity token, or null when it is not valid.
public interface IInternalTokenVerifier
{
    Task<string?> VerifiedEmail(string token, string audience, CancellationToken ct);
}

public sealed class GoogleInternalTokenVerifier(ILogger<GoogleInternalTokenVerifier> logger) : IInternalTokenVerifier
{
    public async Task<string?> VerifiedEmail(string token, string audience, CancellationToken ct)
    {
        try
        {
            ct.ThrowIfCancellationRequested();
            var payload = await GoogleJsonWebSignature.ValidateAsync(token,
                new GoogleJsonWebSignature.ValidationSettings { Audience = [audience] });
            return payload.Issuer is "accounts.google.com" or "https://accounts.google.com" && payload.EmailVerified
                ? payload.Email
                : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogInformation("Rejected an invalid internal identity token ({ErrorType}).", ex.GetType().Name);
            return null;
        }
    }
}

/// Authenticates `/internal/*` calls from Cloud Scheduler and Cloud Tasks. A caller presents a Google
/// identity token whose audience is `Internal:Audience` and whose email is in `Internal:AllowedCallers`.
/// The legacy `X-Cleanup-Token` header is honoured only while `Cleanup:Token` is configured, so
/// removing that secret retires it. Missing configuration rejects the call.
public sealed class InternalCallGate(IConfiguration configuration, IInternalTokenVerifier verifier)
{
    public async Task<bool> Allow(HttpRequest request, CancellationToken ct)
    {
        var authorization = request.Headers.Authorization.ToString();
        if (authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var audience = configuration["Internal:Audience"];
            var token = authorization["Bearer ".Length..].Trim();
            if (!string.IsNullOrWhiteSpace(audience) && token.Length is >= 1 and <= 16_384
                && await verifier.VerifiedEmail(token, audience, ct) is { } email
                && AllowedCallers().Contains(email, StringComparer.OrdinalIgnoreCase))
                return true;
        }

        var expected = configuration["Cleanup:Token"];
        var supplied = request.Headers["X-Cleanup-Token"].ToString();
        return !string.IsNullOrEmpty(expected)
            && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(supplied), Encoding.UTF8.GetBytes(expected));
    }

    private string[] AllowedCallers() =>
        (configuration["Internal:AllowedCallers"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
