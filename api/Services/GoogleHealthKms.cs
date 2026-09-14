using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Google.Apis.Auth.OAuth2;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public interface IGoogleHealthKms
{
    Task<string> EncryptAsync(string plaintext, CancellationToken ct);
    Task<string> DecryptAsync(string ciphertext, CancellationToken ct);
}

public class GoogleCloudKmsService(HttpClient http, IConfiguration config, IHostEnvironment env, Func<CancellationToken, Task<string>>? accessToken = null) : IGoogleHealthKms
{
    private GoogleCredential? credential;
    private static readonly byte[] FallbackKey = SHA256.HashData(Encoding.UTF8.GetBytes("NutritionApp-Dev-GoogleHealth-Key-2026"));

    public string? KeyName => (config["Integrations:KmsKeyName"] ?? config["GoogleHealth:KmsKeyName"] ?? config["GoogleHealthKmsKeyName"])?.Trim();

    public async Task<string> EncryptAsync(string plaintext, CancellationToken ct)
    {
        var keyName = KeyName;
        if (string.IsNullOrEmpty(keyName))
        {
            if (!env.IsDevelopment())
                throw new InvalidOperationException("GoogleHealth:KmsKeyName must be configured in production.");
            return LocalEncrypt(plaintext);
        }

        var url = $"https://cloudkms.googleapis.com/v1/{keyName}:encrypt";
        var base64Plaintext = Convert.ToBase64String(Encoding.UTF8.GetBytes(plaintext));
        var body = new { plaintext = base64Plaintext };

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
        };

        try
        {
            var token = accessToken != null
                ? await accessToken(ct)
                : await GetTokenAsync(ct);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new DomainException("Google Cloud KMS credentials are unavailable.", 503);
        }

        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
            throw new DomainException($"Google Cloud KMS encryption failed with status {response.StatusCode}.", 503);

        var json = await response.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.TryGetProperty("ciphertext", out var ctProp) && ctProp.GetString() is { } ctVal)
            return ctVal;

        throw new DomainException("Google Cloud KMS returned an unexpected response format.", 503);
    }

    public async Task<string> DecryptAsync(string ciphertext, CancellationToken ct)
    {
        if (ciphertext.StartsWith("local:", StringComparison.Ordinal))
        {
            if (!env.IsDevelopment())
                throw new InvalidOperationException("Local test ciphertext cannot be decrypted in production.");
            return LocalDecrypt(ciphertext);
        }

        var keyName = KeyName;
        if (string.IsNullOrEmpty(keyName))
        {
            if (!env.IsDevelopment())
                throw new InvalidOperationException("GoogleHealth:KmsKeyName must be configured in production.");
            return LocalDecrypt(ciphertext);
        }

        var url = $"https://cloudkms.googleapis.com/v1/{keyName}:decrypt";
        var body = new { ciphertext };

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
        };

        try
        {
            var token = accessToken != null
                ? await accessToken(ct)
                : await GetTokenAsync(ct);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new DomainException("Google Cloud KMS credentials are unavailable.", 503);
        }

        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
            throw new DomainException($"Google Cloud KMS decryption failed with status {response.StatusCode}.", 503);

        var json = await response.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.TryGetProperty("plaintext", out var ptProp) && ptProp.GetString() is { } ptVal)
        {
            var bytes = Convert.FromBase64String(ptVal);
            return Encoding.UTF8.GetString(bytes);
        }

        throw new DomainException("Google Cloud KMS returned an unexpected response format.", 503);
    }

    private async Task<string> GetTokenAsync(CancellationToken ct)
    {
        credential ??= (await GoogleCredential.GetApplicationDefaultAsync(ct)).CreateScoped("https://www.googleapis.com/auth/cloudkms");
        return await credential.UnderlyingCredential.GetAccessTokenForRequestAsync(cancellationToken: ct);
    }

    private static string LocalEncrypt(string plaintext)
    {
        var plaintextBytes = Encoding.UTF8.GetBytes(plaintext);
        var nonce = new byte[AesGcm.NonceByteSizes.MaxSize];
        RandomNumberGenerator.Fill(nonce);
        var tag = new byte[AesGcm.TagByteSizes.MaxSize];
        var ciphertextBytes = new byte[plaintextBytes.Length];

        using var aes = new AesGcm(FallbackKey, AesGcm.TagByteSizes.MaxSize);
        aes.Encrypt(nonce, plaintextBytes, ciphertextBytes, tag);

        var combined = new byte[nonce.Length + tag.Length + ciphertextBytes.Length];
        Buffer.BlockCopy(nonce, 0, combined, 0, nonce.Length);
        Buffer.BlockCopy(tag, 0, combined, nonce.Length, tag.Length);
        Buffer.BlockCopy(ciphertextBytes, 0, combined, nonce.Length + tag.Length, ciphertextBytes.Length);

        return "local:" + Convert.ToBase64String(combined);
    }

    private static string LocalDecrypt(string ciphertext)
    {
        var raw = ciphertext.StartsWith("local:", StringComparison.Ordinal)
            ? ciphertext["local:".Length..]
            : ciphertext;

        var combined = Convert.FromBase64String(raw);
        var nonceSize = AesGcm.NonceByteSizes.MaxSize;
        var tagSize = AesGcm.TagByteSizes.MaxSize;
        if (combined.Length < nonceSize + tagSize)
            throw new DomainException("Invalid ciphertext payload.", 400);

        var nonce = new byte[nonceSize];
        var tag = new byte[tagSize];
        var cipherBytes = new byte[combined.Length - nonceSize - tagSize];

        Buffer.BlockCopy(combined, 0, nonce, 0, nonceSize);
        Buffer.BlockCopy(combined, nonceSize, tag, 0, tagSize);
        Buffer.BlockCopy(combined, nonceSize + tagSize, cipherBytes, 0, cipherBytes.Length);

        var plainBytes = new byte[cipherBytes.Length];
        using var aes = new AesGcm(FallbackKey, tagSize);
        aes.Decrypt(nonce, cipherBytes, tag, plainBytes);

        return Encoding.UTF8.GetString(plainBytes);
    }
}
