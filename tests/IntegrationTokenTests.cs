using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
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
    public async Task Parallel_requests_exchange_the_same_durable_consent_without_consuming_it()
    {
        var connectionId = Guid.NewGuid();
        const long generation = 7;
        var userId = await SeedGrant(connectionId, generation, grantedAt: DateTime.UtcNow.AddDays(-45));
        var handler = new CentralHandler(async request =>
        {
            Assert.Equal("nutrition-api:nutrition-secret", Encoding.UTF8.GetString(Convert.FromBase64String(request.Headers.Authorization!.Parameter!)));
            Assert.EndsWith("/connect/token", request.RequestUri!.AbsolutePath);
            var form = await ParseForm(request, default);
            Assert.Equal("fitness_connection", form["grant_type"]);
            Assert.Equal(connectionId.ToString("D"), form["connection_id"]);
            return Success("access", 300);
        });

        var tasks = Enumerable.Range(0, 12).Select(async _ =>
        {
            await using var db = Open(userId);
            return await CreateService(db, handler, connectionId, generation)
                .AccessToken("workout", "workout.training_summary.read", default);
        });
        var results = await Task.WhenAll(tasks);

        Assert.All(results, value => Assert.Equal("access", value));
        Assert.Equal(1, handler.CallCount);
        await using var savedDb = Open(userId);
        var grant = await savedDb.IntegrationGrants.AsNoTracking().SingleAsync(x => x.Peer == "workout");
        Assert.Equal("active", grant.Status);
        Assert.Equal(connectionId, grant.CentralConnectionId);
        Assert.Equal(generation, grant.CentralGeneration);
        Assert.Equal("", grant.EncryptedRefreshToken);
        Assert.Equal(DateTime.UtcNow.AddDays(-45).Date, grant.GrantedAt!.Value.Date);
    }

    [Fact]
    public async Task Legacy_grant_requires_explicit_upgrade_and_is_never_refreshed()
    {
        var userId = await SeedGrant(connectionId: null, generation: null);
        var handler = new CentralHandler(_ => throw new Xunit.Sdk.XunitException("A legacy rotating token must not be used."));
        await using var db = Open(userId);
        var service = CreateService(db, handler, Guid.NewGuid(), 1);

        Assert.Null(await service.AccessToken("workout", "workout.training_summary.read", default));
        Assert.Equal("upgrade_required", await service.GetConnectionState("workout", default));
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task Central_outage_preserves_active_durable_connection()
    {
        var connectionId = Guid.NewGuid();
        const long generation = 4;
        var userId = await SeedGrant(connectionId, generation);
        var handler = new CentralHandler(request => Task.FromResult(request.RequestUri!.AbsolutePath.EndsWith("/connect/token", StringComparison.Ordinal)
            ? Error(HttpStatusCode.BadRequest, "temporarily_unavailable")
            : new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)));

        await using var db = Open(userId);
        var service = CreateService(db, handler, connectionId, generation);
        Assert.Null(await service.AccessToken("workout", "workout.training_summary.read", default));

        var grant = await db.IntegrationGrants.AsNoTracking().SingleAsync(x => x.Peer == "workout");
        Assert.Equal("active", grant.Status);
        Assert.Equal(connectionId, grant.CentralConnectionId);
        Assert.Equal(generation, grant.CentralGeneration);
        Assert.Equal("temporary_unavailable", await service.GetConnectionState("workout", default));
    }

    [Fact]
    public async Task Owner_confirmed_revocation_requires_reconnect_but_transient_status_does_not()
    {
        var connectionId = Guid.NewGuid();
        const long generation = 5;
        var userId = await SeedGrant(connectionId, generation);
        var state = "revoked";
        var handler = new CentralHandler(request => Task.FromResult(request.RequestUri!.AbsolutePath.EndsWith("/connect/token", StringComparison.Ordinal)
            ? Success("access", 300)
            : request.RequestUri.AbsolutePath.EndsWith("/" + connectionId.ToString("D"), StringComparison.Ordinal)
                ? Json(HttpStatusCode.OK, new { status = state, generation })
                : new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)));

        await using var db = Open(userId);
        var service = CreateService(db, handler, connectionId, generation);
        Assert.Equal("reconnect_required", await service.GetConnectionState("workout", default));
        Assert.Equal("reconnect_required", (await db.IntegrationGrants.SingleAsync(x => x.Peer == "workout")).Status);
    }

    [Fact]
    public async Task Incoming_validation_is_uncached_and_fails_closed_on_central_revocation()
    {
        var connectionId = Guid.NewGuid();
        const long generation = 3;
        var active = true;
        var handler = new CentralHandler(request => Task.FromResult(active
            ? Json(HttpStatusCode.OK, new { active = true, generation })
            : Json(HttpStatusCode.Gone, new { active = false })));
        await using var db = Open(Guid.NewGuid());
        var service = CreateService(db, handler, connectionId, generation);
        var token = new ValidatedAccessToken("subject-1", "https://fitness.example.com",
            new HashSet<string> { "nutrition.training_context.read" }, DateTime.UtcNow.AddMinutes(5), connectionId, generation);

        await service.ValidateIncomingConnection(token, default);
        active = false;
        var error = await Assert.ThrowsAsync<DomainException>(() => service.ValidateIncomingConnection(token, default));

        Assert.Equal(403, error.Status);
        Assert.Equal(2, handler.CallCount);
        Assert.Contains("/validate?generation=3", handler.LastRequestUri);
    }

    [Fact]
    public async Task Disconnect_keeps_local_consent_when_central_revocation_is_unavailable_and_tombstones_after_success()
    {
        var connectionId = Guid.NewGuid();
        const long generation = 2;
        var userId = await SeedGrant(connectionId, generation);
        var centralSuccess = false;
        var handler = new CentralHandler(request => Task.FromResult(centralSuccess
            ? new HttpResponseMessage(HttpStatusCode.NoContent)
            : new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)));

        await using var db = Open(userId);
        var service = CreateService(db, handler, connectionId, generation);
        await Assert.ThrowsAsync<DomainException>(() => service.RevokeAndPurge("workout", default));
        Assert.Equal("active", (await db.IntegrationGrants.AsNoTracking().SingleAsync(x => x.Peer == "workout")).Status);

        centralSuccess = true;
        await service.RevokeAndPurge("workout", default);
        var tombstone = await db.IntegrationGrants.AsNoTracking().SingleAsync(x => x.Peer == "workout");
        Assert.Equal("revoked", tombstone.Status);
        Assert.Equal(connectionId, tombstone.CentralConnectionId);
        Assert.Equal(generation, tombstone.CentralGeneration);
        Assert.Equal("disconnected", await service.GetConnectionState("workout", default));
    }

    [Fact]
    public async Task Legacy_disconnect_without_a_revocation_credential_fails_without_clearing_consent()
    {
        var userId = await SeedGrant(connectionId: null, generation: null);
        await using var db = Open(userId);
        var grant = await db.IntegrationGrants.SingleAsync(x => x.Peer == "workout");
        grant.EncryptedRefreshToken = "";
        await db.SaveChangesAsync();
        var handler = new CentralHandler(_ => throw new Xunit.Sdk.XunitException("Central revocation must not be skipped."));
        var service = CreateService(db, handler, Guid.NewGuid(), 1);

        var error = await Assert.ThrowsAsync<DomainException>(() => service.RevokeAndPurge("workout", default));

        Assert.Equal(503, error.Status);
        Assert.Equal("active", (await db.IntegrationGrants.AsNoTracking().SingleAsync(x => x.Peer == "workout")).Status);
        Assert.Equal(0, handler.CallCount);
    }

    private async Task<Guid> SeedGrant(Guid? connectionId, long? generation, DateTime? grantedAt = null)
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
            CentralConnectionId = connectionId,
            CentralGeneration = generation,
            EncryptedRefreshToken = connectionId is null ? "legacy-encrypted-token" : "",
            Revision = 1,
            GrantedAt = grantedAt ?? DateTime.UtcNow
        });
        await db.SaveChangesAsync();
        return userId;
    }

    private IntegrationTokenService CreateService(AppDb db, HttpMessageHandler handler, Guid connectionId, long generation)
        => new(db, new StubHttpClientFactory(handler), Config, new FakeValidator(connectionId, generation), new FakeKms());

    private static HttpResponseMessage Success(string access, int expiresIn)
        => Json(HttpStatusCode.OK, new { access_token = access, expires_in = expiresIn });

    private static HttpResponseMessage Error(HttpStatusCode status, string error)
        => Json(status, new { error });

    private static HttpResponseMessage Json(HttpStatusCode status, object body)
        => new(status) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };

    private static async Task<Dictionary<string, string>> ParseForm(HttpRequestMessage request, CancellationToken ct)
        => (await request.Content!.ReadAsStringAsync(ct)).Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .Where(parts => parts.Length == 2)
            .ToDictionary(parts => Uri.UnescapeDataString(parts[0]),
                parts => Uri.UnescapeDataString(parts[1].Replace('+', ' ')));

    private sealed class FakeKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult("enc:" + plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext);
    }

    private sealed class FakeValidator(Guid connectionId, long generation) : ISharedAccessTokenValidator
    {
        public Task<ValidatedAccessToken> RequireAccessToken(string accessToken, string requiredScope, CancellationToken ct)
            => Task.FromResult(new ValidatedAccessToken("subject-1", "https://fitness.example.com",
                new HashSet<string> { requiredScope }, DateTime.UtcNow.AddMinutes(5), connectionId, generation));
    }

    private sealed class StubHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        private readonly HttpClient client = new(handler);
        public HttpClient CreateClient(string name) => client;
    }

    private sealed class CentralHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> responder) : HttpMessageHandler
    {
        public int CallCount { get; private set; }
        public string LastRequestUri { get; private set; } = "";

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;
            LastRequestUri = request.RequestUri!.PathAndQuery;
            return await responder(request);
        }
    }
}
