using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// The retry is wired into the real upload path: a momentary Google error is absorbed in the same pass,
/// while a lost create response is still left for explicit recovery.
public sealed class GoogleHealthUploadRetryTests
{
    private const string GoogleIdHash = "retry-google";

    [Fact]
    public async Task A_weight_upload_that_gets_a_503_then_succeeds_completes_in_one_pass()
    {
        await using var fixture = await Fixture.Create();
        var handler = new Handler(request => request.RequestUri!.Host == "health.googleapis.com" && fixture.ProviderCalls++ == 0
            ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
            : Ok(request));

        var result = await fixture.Process(handler);

        Assert.Equal(1, result.Succeeded);
        Assert.Equal(2, fixture.ProviderCalls);
        Assert.Equal("succeeded", await fixture.State());
    }

    [Fact]
    public async Task A_weight_upload_that_keeps_failing_is_left_for_the_queues_backoff_after_three_attempts()
    {
        await using var fixture = await Fixture.Create();
        var handler = new Handler(request => request.RequestUri!.Host == "health.googleapis.com" && ++fixture.ProviderCalls > 0
            ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
            : Ok(request));

        var result = await fixture.Process(handler);

        Assert.Equal(1, result.Retried);
        Assert.Equal(3, fixture.ProviderCalls);
        Assert.Equal("pending", await fixture.State());
    }

    [Fact]
    public async Task A_lost_create_response_is_never_resent()
    {
        await using var fixture = await Fixture.Create();
        var handler = new Handler(request => request.RequestUri!.Host == "health.googleapis.com" && ++fixture.ProviderCalls > 0
            ? throw new HttpRequestException("connection reset after send")
            : Ok(request));

        var result = await fixture.Process(handler);

        Assert.Equal(1, result.Unknown);
        Assert.Equal(1, fixture.ProviderCalls);
        Assert.Equal("unknown", await fixture.State());
    }

    private static HttpResponseMessage Ok(HttpRequestMessage request) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(request.RequestUri!.Host == "oauth2.googleapis.com"
            ? "{\"access_token\":\"token\"}"
            : "{\"done\":true,\"name\":\"users/me/dataTypes/weight/dataPoints/1\"}")
    };

    private sealed class Fixture : IAsyncDisposable
    {
        public int ProviderCalls;
        private readonly AppDb db;

        private Fixture(AppDb db) => this.db = db;

        public static async Task<Fixture> Create()
        {
            var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options) { CurrentUser = Guid.NewGuid() };
            await db.Database.OpenConnectionAsync();
            await db.Database.EnsureCreatedAsync();
            var user = db.CurrentUser.Value;
            db.Users.Add(new AppUser { Id = user, DisplayName = "retry-user", IdentitySubject = "retry-subject" });
            db.GoogleHealthConnections.Add(new GoogleHealthConnection
            {
                UserId = user, GoogleIdHash = GoogleIdHash, EncryptedRefreshToken = "refresh",
                GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWeightSyncService.WeightScope }),
                WeightSyncEnabled = true, Status = "connected"
            });
            db.GoogleHealthWeightSyncWork.Add(new GoogleHealthWeightSyncWork
            {
                Id = Guid.NewGuid(), UserId = user, WeightId = Guid.NewGuid(), DesiredRevision = 1,
                DesiredDate = new DateOnly(2026, 9, 18), DesiredKg = 72.5, GoogleIdHash = GoogleIdHash,
                ConnectionGeneration = 1, ProcessingState = "pending", NextAttemptAt = DateTime.UtcNow.AddMinutes(-1)
            });
            await db.SaveChangesAsync();
            return new Fixture(db);
        }

        public Task<GoogleHealthWeightSyncProcessResult> Process(HttpMessageHandler handler)
        {
            var http = new HttpClient(handler, disposeHandler: false);
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret"
            }).Build();
            var google = new GoogleHealthService(http, db, new PlainKms(), config);
            return new GoogleHealthWeightSyncService(db, google, http, null, (_, _) => Task.CompletedTask).ProcessDueAsync(default);
        }

        public async Task<string> State()
        {
            db.ChangeTracker.Clear();
            return (await db.GoogleHealthWeightSyncWork.SingleAsync()).ProcessingState;
        }

        public async ValueTask DisposeAsync() => await db.DisposeAsync();
    }

    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Task.FromResult(respond(request));
    }

    private sealed class PlainKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext);
    }
}
