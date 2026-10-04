using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// Each outbound upload asks for an access token. One exchange (and one KMS decrypt) serves every
/// record until the token nears expiry; a reconnect or lost permission never reuses it.
public sealed class GoogleHealthAccessTokenTests : IAsyncLifetime
{
    private readonly CountingKms kms = new();
    private readonly TokenEndpoint endpoint = new();
    private AppDb db = null!;
    private Guid userId;

    public async Task InitializeAsync()
    {
        db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options) { CurrentUser = Guid.NewGuid() };
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        userId = db.CurrentUser!.Value;
        db.Users.Add(new AppUser { Id = userId, DisplayName = "token-user", IdentitySubject = $"token-{userId:N}" });
        db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = userId, GoogleIdHash = $"token-{userId:N}", EncryptedRefreshToken = "refresh-1", Status = "connected",
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWeightSyncService.WeightScope, GoogleHealthNutritionSyncService.NutritionScope })
        });
        await db.SaveChangesAsync();
    }

    public async Task DisposeAsync() => await db.DisposeAsync();

    [Fact]
    public async Task Consecutive_records_reuse_one_token_exchange_and_one_decrypt()
    {
        var google = Google();

        var first = await google.GetAccessTokenAsync(userId, GoogleHealthWeightSyncService.WeightScope, default);
        var second = await google.GetAccessTokenAsync(userId, GoogleHealthWeightSyncService.WeightScope, default);
        var otherStream = await google.GetAccessTokenAsync(userId, GoogleHealthNutritionSyncService.NutritionScope, default);

        Assert.Equal("access-1", first);
        Assert.Equal(first, second);
        Assert.Equal(first, otherStream);
        Assert.Equal(1, endpoint.Calls);
        Assert.Equal(1, kms.Decrypts);
    }

    [Fact]
    public async Task A_reconnect_or_reconnect_required_state_never_reuses_the_cached_token()
    {
        var google = Google();
        await google.GetAccessTokenAsync(userId, GoogleHealthWeightSyncService.WeightScope, default);

        var connection = await db.GoogleHealthConnections.SingleAsync();
        connection.EncryptedRefreshToken = "refresh-2";
        await db.SaveChangesAsync();
        Assert.Equal("access-2", await google.GetAccessTokenAsync(userId, GoogleHealthWeightSyncService.WeightScope, default));

        await google.MarkReconnectRequiredAsync(userId, default);
        Assert.Null(await google.GetAccessTokenAsync(userId, GoogleHealthWeightSyncService.WeightScope, default));
        Assert.Equal(2, endpoint.Calls);
    }

    [Fact]
    public async Task A_token_close_to_expiry_is_not_cached()
    {
        endpoint.ExpiresIn = 120;
        var google = Google();

        await google.GetAccessTokenAsync(userId, GoogleHealthWeightSyncService.WeightScope, default);
        await google.GetAccessTokenAsync(userId, GoogleHealthWeightSyncService.WeightScope, default);

        Assert.Equal(2, endpoint.Calls);
    }

    [Fact]
    public async Task A_permission_the_connection_lacks_is_refused_even_with_a_cached_token()
    {
        var google = Google();
        await google.GetAccessTokenAsync(userId, GoogleHealthWeightSyncService.WeightScope, default);

        Assert.Null(await google.GetAccessTokenAsync(userId, GoogleHealthWeightImportService.ReadScope, default));
    }

    private GoogleHealthService Google()
        => new(new HttpClient(endpoint, disposeHandler: false), db, kms, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret"
        }).Build());

    private sealed class CountingKms : IGoogleHealthKms
    {
        public int Decrypts;
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct)
        {
            Decrypts++;
            return Task.FromResult(ciphertext);
        }
    }

    private sealed class TokenEndpoint : HttpMessageHandler
    {
        public int Calls;
        public int ExpiresIn = 3599;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Assert.Equal("oauth2.googleapis.com", request.RequestUri!.Host);
            var form = await request.Content!.ReadAsStringAsync(ct);
            Calls++;
            var token = form.Contains("refresh-2", StringComparison.Ordinal) ? "access-2" : "access-1";
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent($"{{\"access_token\":\"{token}\",\"expires_in\":{ExpiresIn}}}")
            };
        }
    }
}
