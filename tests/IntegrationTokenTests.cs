using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class IntegrationTokenTests : IAsyncLifetime
{
    private readonly string dbPath = Path.Combine(Path.GetTempPath(), $"nutrition-peer-{Guid.NewGuid()}.db");

    private AppDb Open(Guid userId)
        => new(new DbContextOptionsBuilder<AppDb>().UseSqlite($"Data Source={dbPath}").Options)
        {
            CurrentUser = userId
        };

    private static IConfiguration Config => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Identity:Authority"] = "https://fitness.example.com",
        ["Identity:ClientId"] = "nutrition-api",
        ["Identity:ClientSecret"] = "nutrition-secret"
    }).Build();

    public async Task InitializeAsync()
    {
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite($"Data Source={dbPath}").Options);
        await db.Database.EnsureCreatedAsync();
    }

    public Task DisposeAsync()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(dbPath)) File.Delete(dbPath);
        return Task.CompletedTask;
    }

    [Fact]
    public async Task Rotation_retries_when_another_revision_saved_a_new_refresh_token()
    {
        var userId = await SeedGrant("old", revision: 1);
        var calls = 0;
        var handler = new PeerTokenHandler(async refresh =>
        {
            calls++;
            if (refresh == "old")
            {
                await using var competingDb = Open(userId);
                var grant = await competingDb.IntegrationGrants.SingleAsync(x => x.Peer == "workout");
                grant.EncryptedRefreshToken = "enc:new";
                grant.Revision = 2;
                await competingDb.SaveChangesAsync();
                return Error(HttpStatusCode.BadRequest, "invalid_grant");
            }

            Assert.Equal("new", refresh);
            return Success("access-after-rotation", "newer");
        });

        await using var db = Open(userId);
        var service = CreateService(db, handler);
        var access = await service.AccessToken("workout", "workout.training_summary.read", default);

        Assert.Equal("access-after-rotation", access);
        Assert.Equal(2, calls);
        var saved = await db.IntegrationGrants.AsNoTracking().SingleAsync(x => x.Peer == "workout");
        Assert.Equal("active", saved.Status);
        Assert.Equal("newer", await new FakeKms().DecryptAsync(saved.EncryptedRefreshToken, default));
    }

    [Fact]
    public async Task Rotated_refresh_token_survives_service_recreation()
    {
        var userId = await SeedGrant("old", revision: 1);
        var handler = new PeerTokenHandler(refresh =>
            Task.FromResult(refresh switch
            {
                "old" => Success("access-one", "new"),
                "new" => Success("access-two", "newer"),
                _ => Error(HttpStatusCode.BadRequest, "invalid_grant")
            }));

        await using (var firstDb = Open(userId))
        {
            var service = CreateService(firstDb, handler);
            Assert.Equal("access-one", await service.AccessToken("workout", "workout.training_summary.read", default));
        }

        await using (var secondDb = Open(userId))
        {
            var service = CreateService(secondDb, handler);
            Assert.Equal("access-two", await service.AccessToken("workout", "workout.training_summary.read", default));
        }

        Assert.Equal(2, handler.CallCount);
    }

    [Fact]
    public async Task Non_invalid_grant_bad_request_keeps_workout_connected()
    {
        var userId = await SeedGrant("old", revision: 1);
        var handler = new PeerTokenHandler(_ => Task.FromResult(Error(HttpStatusCode.BadRequest, "invalid_client")));

        await using var db = Open(userId);
        var service = CreateService(db, handler);
        Assert.Null(await service.AccessToken("workout", "workout.training_summary.read", default));

        var grant = await db.IntegrationGrants.AsNoTracking().SingleAsync(x => x.Peer == "workout");
        Assert.Equal("active", grant.Status);
        Assert.Equal("enc:old", grant.EncryptedRefreshToken);
    }

    [Fact]
    public async Task Confirmed_invalid_grant_revokes_workout_connection()
    {
        var userId = await SeedGrant("old", revision: 1);
        var handler = new PeerTokenHandler(_ => Task.FromResult(Error(HttpStatusCode.BadRequest, "invalid_grant")));

        await using var db = Open(userId);
        var service = CreateService(db, handler);
        Assert.Null(await service.AccessToken("workout", "workout.training_summary.read", default));

        var grant = await db.IntegrationGrants.AsNoTracking().SingleAsync(x => x.Peer == "workout");
        Assert.Equal("revoked", grant.Status);
        Assert.Equal("", grant.EncryptedRefreshToken);
    }

    private async Task<Guid> SeedGrant(string refresh, long revision)
    {
        var userId = Guid.NewGuid();
        await using var db = Open(userId);
        db.Users.Add(new AppUser { Id = userId, IdentitySubject = "subject-1", DisplayName = "Test user" });
        db.IntegrationGrants.Add(new IntegrationGrant
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Peer = "workout",
            Status = "active",
            EncryptedRefreshToken = "enc:" + refresh,
            Revision = revision,
            GrantedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
        return userId;
    }

    private IntegrationTokenService CreateService(AppDb db, HttpMessageHandler handler)
        => new(db, new StubHttpClientFactory(handler), Config, new FakeValidator(), new FakeKms());

    private static HttpResponseMessage Success(string access, string refresh)
        => new(HttpStatusCode.OK)
        {
            Content = new StringContent(JsonSerializer.Serialize(new { access_token = access, refresh_token = refresh }), Encoding.UTF8, "application/json")
        };

    private static HttpResponseMessage Error(HttpStatusCode status, string error)
        => new(status)
        {
            Content = new StringContent(JsonSerializer.Serialize(new { error }), Encoding.UTF8, "application/json")
        };

    private sealed class FakeKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct)
            => Task.FromResult("enc:" + plaintext);

        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct)
            => Task.FromResult(ciphertext.StartsWith("enc:", StringComparison.Ordinal) ? ciphertext[4..] : throw new InvalidOperationException());
    }

    private sealed class FakeValidator : ISharedAccessTokenValidator
    {
        public Task<ValidatedAccessToken> RequireAccessToken(string accessToken, string requiredScope, CancellationToken ct)
            => Task.FromResult(new ValidatedAccessToken("subject-1", "https://fitness.example.com", new HashSet<string> { requiredScope }, DateTime.UtcNow.AddMinutes(5)));
    }

    private sealed class StubHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        private readonly HttpClient client = new(handler);

        public HttpClient CreateClient(string name) => client;
    }

    private sealed class PeerTokenHandler(Func<string, Task<HttpResponseMessage>> responder) : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = await request.Content!.ReadAsStringAsync(cancellationToken);
            var refresh = body.Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Select(part => part.Split('=', 2))
                .Where(parts => parts.Length == 2)
                .ToDictionary(parts => parts[0], parts => Uri.UnescapeDataString(parts[1].Replace('+', ' ')))
                ["refresh_token"];
            CallCount++;
            return await responder(refresh);
        }
    }
}
