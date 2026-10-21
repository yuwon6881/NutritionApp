using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// An upload is reported as "may have gone through" only when its create request actually left; every
/// uncertain case records its own reason so the Technical detail can say what happened.
public sealed class GoogleHealthNutritionUnknownTests
{
    private const string GoogleIdHash = "nutrition-unknown-google";

    [Fact]
    public async Task A_failure_before_anything_is_sent_retries_instead_of_becoming_unknown()
    {
        await using var fixture = await Fixture.Create();
        var handler = new Handler(request => request.RequestUri!.Host == "oauth2.googleapis.com"
            ? throw new InvalidOperationException("token endpoint unusable")
            : Ok());

        var result = await fixture.Process(handler);

        Assert.Equal(1, result.Retried);
        Assert.Equal(0, result.Unknown);
        Assert.Equal(0, fixture.ProviderCalls);
        var work = await fixture.Work();
        Assert.Equal("pending", work.ProcessingState);
        Assert.Equal("", work.LeaseId);
        Assert.DoesNotContain("check Google Health", work.LastErrorMessage, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_create_answer_without_the_new_entry_name_is_unknown_with_that_reason()
    {
        await using var fixture = await Fixture.Create();
        var handler = new Handler(request => request.RequestUri!.Host == "oauth2.googleapis.com"
            ? Ok()
            : Json("{\"done\":true,\"name\":\"operations/1\"}", fixture));

        var result = await fixture.Process(handler);

        Assert.Equal(1, result.Unknown);
        Assert.Equal(1, fixture.ProviderCalls);
        var work = await fixture.Work();
        Assert.Equal("unknown", work.ProcessingState);
        Assert.Contains("did not return the new entry's name", work.LastErrorMessage);
    }

    [Fact]
    public async Task A_lost_create_response_is_unknown_with_the_lost_response_reason()
    {
        await using var fixture = await Fixture.Create();
        var handler = new Handler(request => request.RequestUri!.Host == "oauth2.googleapis.com"
            ? Ok()
            : throw new HttpRequestException("connection reset after send"));

        var result = await fixture.Process(handler);

        Assert.Equal(1, result.Unknown);
        var work = await fixture.Work();
        Assert.Equal("unknown", work.ProcessingState);
        Assert.Contains("create response was lost", work.LastErrorMessage, StringComparison.OrdinalIgnoreCase);
    }

    private static HttpResponseMessage Ok() => new(HttpStatusCode.OK)
    {
        Content = new StringContent("{\"access_token\":\"token\"}")
    };

    private static HttpResponseMessage Json(string body, Fixture fixture)
    {
        fixture.ProviderCalls++;
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) };
    }

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
            db.Users.Add(new AppUser { Id = user, DisplayName = "unknown-user", IdentitySubject = "unknown-subject" });
            db.GoogleHealthConnections.Add(new GoogleHealthConnection
            {
                UserId = user, GoogleIdHash = GoogleIdHash, EncryptedRefreshToken = "refresh",
                GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthNutritionSyncService.NutritionScope }),
                NutritionSyncEnabled = true, Status = "connected"
            });
            db.GoogleHealthNutritionSyncWork.Add(new GoogleHealthNutritionSyncWork
            {
                Id = Guid.NewGuid(), UserId = user, EntryId = Guid.NewGuid(), DesiredRevision = 1,
                DesiredDate = new DateOnly(2026, 9, 18), DesiredTime = "12:30", DesiredName = "Chicken Rice", DesiredCalories = 650,
                GoogleIdHash = GoogleIdHash, ConnectionGeneration = 1, ProcessingState = "pending",
                NextAttemptAt = DateTime.UtcNow.AddMinutes(-1)
            });
            await db.SaveChangesAsync();
            return new Fixture(db);
        }

        public Task<GoogleHealthNutritionSyncProcessResult> Process(HttpMessageHandler handler)
        {
            var http = new HttpClient(handler, disposeHandler: false);
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret"
            }).Build();
            var google = new GoogleHealthService(http, db, new PlainKms(), config);
            return new GoogleHealthNutritionSyncService(db, google, http, null, (_, _) => Task.CompletedTask).ProcessDueAsync(default);
        }

        public async Task<GoogleHealthNutritionSyncWork> Work()
        {
            db.ChangeTracker.Clear();
            return await db.GoogleHealthNutritionSyncWork.SingleAsync();
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
