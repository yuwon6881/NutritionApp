using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// A weigh-in deleted while its create is still with Google must not orphan the reading Google
/// creates: the work waits for the resource name and then deletes it.
public sealed class GoogleHealthDeleteDuringCreateTests : IAsyncDisposable
{
    private const string GoogleIdHash = "delete-during-create";
    private const string Resource = "users/me/dataTypes/weight/dataPoints/created";
    private readonly Microsoft.Data.Sqlite.SqliteConnection connection = new("Data Source=:memory:");
    private readonly List<string> requests = [];
    private DbContextOptions<AppDb> options = null!;
    private Guid userId;
    private Weight weight = null!;

    [Fact]
    public async Task A_delete_queued_while_the_create_request_is_in_flight_deletes_the_created_reading()
    {
        await Seed();
        var deleted = false;
        var handler = new Handler(async request =>
        {
            if (IsCreate(request) && !deleted)
            {
                deleted = true;
                await QueueDelete();
            }
            return Respond(request, createDone: true);
        });

        await Process(handler);
        await Process(handler);

        Assert.Contains(requests, request => request.Contains(":batchDelete") && request.Contains(Resource));
        var work = await Work();
        Assert.Equal(Resource, work.GoogleResourceName);
        Assert.Equal("succeeded", work.ProcessingState);
    }

    [Fact]
    public async Task A_delete_queued_while_the_create_operation_is_pending_deletes_the_created_reading()
    {
        await Seed();
        var handler = new Handler(request => Task.FromResult(Respond(request, createDone: false)));

        await Process(handler);
        Assert.Equal("awaiting_operation", (await Work()).ProcessingState);
        await QueueDelete();
        await MakeDue();
        await Process(handler);
        await MakeDue();
        await Process(handler);

        Assert.Contains(requests, request => request.Contains(":batchDelete") && request.Contains(Resource));
        Assert.Equal("succeeded", (await Work()).ProcessingState);
    }

    [Fact]
    public async Task A_delete_before_any_create_was_sent_cancels_without_a_request()
    {
        await Seed();
        await QueueDelete();
        await Process(new Handler(request => Task.FromResult(Respond(request, createDone: true))));

        Assert.DoesNotContain(requests, request => request.Contains("health.googleapis.com"));
        Assert.Equal("cancelled", (await Work()).ProcessingState);
    }

    private async Task Seed()
    {
        await connection.OpenAsync();
        options = new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options;
        await using var db = new AppDb(options);
        await db.Database.EnsureCreatedAsync();
        userId = Guid.NewGuid();
        db.CurrentUser = userId;
        db.Users.Add(new AppUser { Id = userId, DisplayName = "delete-user", IdentitySubject = "delete-subject" });
        db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = userId, GoogleIdHash = GoogleIdHash, EncryptedRefreshToken = "refresh",
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWeightSyncService.WeightScope }),
            WeightSyncEnabled = true, Status = "connected"
        });
        weight = new Weight { Id = Guid.NewGuid(), UserId = userId, Date = new DateOnly(2026, 9, 18), Kg = 72.5, Revision = 1 };
        db.GoogleHealthWeightSyncWork.Add(new GoogleHealthWeightSyncWork
        {
            Id = Guid.NewGuid(), UserId = userId, WeightId = weight.Id, DesiredRevision = 1,
            DesiredDate = weight.Date, DesiredKg = weight.Kg, GoogleIdHash = GoogleIdHash,
            ConnectionGeneration = 1, ProcessingState = "pending", NextAttemptAt = DateTime.UtcNow.AddMinutes(-1)
        });
        await db.SaveChangesAsync();
    }

    // The app's own request path: the record is deleted under its own context while the sync pass is waiting on Google.
    private async Task QueueDelete()
    {
        await using var db = new AppDb(options) { CurrentUser = userId };
        var service = new GoogleHealthWeightSyncService(db, Google(db, new HttpClient()), new HttpClient());
        await service.QueueMutationAsync(weight, new Mutation(Guid.NewGuid(), "weight", weight.Id, 1,
            JsonSerializer.SerializeToElement(new { date = weight.Date, kg = weight.Kg }), true), 2, default);
        await db.SaveChangesAsync();
    }

    private async Task MakeDue()
    {
        await using var db = new AppDb(options) { CurrentUser = userId };
        await db.GoogleHealthWeightSyncWork.ExecuteUpdateAsync(set => set.SetProperty(work => work.NextAttemptAt, DateTime.UtcNow.AddMinutes(-1)));
    }

    private async Task Process(HttpMessageHandler handler)
    {
        await using var db = new AppDb(options) { CurrentUser = userId };
        var http = new HttpClient(handler, disposeHandler: false);
        await new GoogleHealthWeightSyncService(db, Google(db, http), http, null, (_, _) => Task.CompletedTask)
            .ProcessDueAsync(default, userId);
    }

    private async Task<GoogleHealthWeightSyncWork> Work()
    {
        await using var db = new AppDb(options) { CurrentUser = userId };
        return await db.GoogleHealthWeightSyncWork.AsNoTracking().SingleAsync();
    }

    private static GoogleHealthService Google(AppDb db, HttpClient http)
        => new(http, db, new PlainKms(), new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret"
        }).Build());

    private static bool IsCreate(HttpRequestMessage request)
        => request.Method == HttpMethod.Post && request.RequestUri!.AbsolutePath.EndsWith("/weight/dataPoints", StringComparison.Ordinal);

    private HttpResponseMessage Respond(HttpRequestMessage request, bool createDone)
    {
        var body = request.Content?.ReadAsStringAsync().GetAwaiter().GetResult() ?? "";
        requests.Add($"{request.Method} {request.RequestUri} {body}");
        string json;
        if (request.RequestUri!.Host == "oauth2.googleapis.com") json = "{\"access_token\":\"token\"}";
        else if (IsCreate(request))
            json = createDone ? $"{{\"done\":true,\"name\":\"{Resource}\"}}" : "{\"done\":false,\"name\":\"operations/create-1\"}";
        else if (request.Method == HttpMethod.Get)
            json = $"{{\"done\":true,\"name\":\"operations/create-1\",\"response\":{{\"name\":\"{Resource}\"}}}}";
        else json = "{\"done\":true}";
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) };
    }

    public async ValueTask DisposeAsync() => await connection.DisposeAsync();

    private sealed class PlainKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext);
    }

    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => respond(request);
    }
}
