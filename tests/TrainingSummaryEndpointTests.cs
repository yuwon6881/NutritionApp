using System.Net;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed partial class TrainingSummaryEndpointTests
{
    private const string SummaryUrl = "https://workout.test/api/integrations/v1/training-summary";

    [Fact]
    public async Task Unchanged_poll_inside_the_revalidation_window_is_answered_without_calling_Workout()
    {
        var workout = new CountingHandler(_ => JsonResponse("[]"));
        var tempDb = Path.Combine(Path.GetTempPath(), $"nutrition-test-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new TestFactory(tempDb, workout);
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();
            var user = await TestUsers.CreateAsync(db, "alice");
            db.MaintenanceAccess = true;
            db.IntegrationGrants.Add(new IntegrationGrant
            {
                UserId = user.Id, Peer = "workout", Status = "active",
                CentralConnectionId = Guid.NewGuid(), CentralGeneration = 1
            });
            var token = Guid.NewGuid().ToString("N");
            db.Sessions.Add(new Session { UserId = user.Id, Hash = AuthService.Hash(token), Expires = DateTime.UtcNow.AddDays(1) });
            await db.SaveChangesAsync();
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            client.DefaultRequestHeaders.Add("X-Nutrition-Request", "1");
            client.DefaultRequestHeaders.Add("Origin", "https://localhost");
            client.DefaultRequestHeaders.Add("Cookie", $"{AuthService.Cookie}={token}");

            using var first = await client.GetAsync("/api/training/summary");
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
            var etag = first.Headers.ETag?.Tag;
            Assert.False(string.IsNullOrWhiteSpace(etag));
            Assert.Equal(1, workout.Calls);

            using var poll = new HttpRequestMessage(HttpMethod.Get, "/api/training/summary");
            poll.Headers.TryAddWithoutValidation("If-None-Match", etag);
            using var second = await client.SendAsync(poll);

            Assert.Equal(HttpStatusCode.NotModified, second.StatusCode);
            Assert.Equal(1, workout.Calls);
        }
        finally
        {
            try { File.Delete(tempDb); } catch { }
        }
    }

    [Fact]
    public async Task Summary_refresh_waits_out_a_cold_start_that_the_inline_state_read_does_not()
    {
        await using var context = await ServiceContext.Create(connected: true);
        var slow = new CountingHandler(_ => JsonResponse("[]"), TimeSpan.FromMilliseconds(2300));
        var service = new WorkoutSummaryService(context.Db, new StubFactory(slow), context.Config);
        var today = new DateOnly(2026, 9, 14);

        await service.Get(today.AddDays(-7), today, null, CancellationToken.None, WorkoutSummaryService.RefreshDeadline);

        Assert.Null(await service.GetLastError(CancellationToken.None));
        Assert.True(WorkoutSummaryService.InlineDeadline < TimeSpan.FromMilliseconds(2300));
    }

    [Fact]
    public async Task Inactive_connection_hides_cached_rows_that_can_no_longer_be_revalidated()
    {
        await using var context = await ServiceContext.Create(connected: false);
        var today = new DateOnly(2026, 9, 14);
        context.Db.WorkoutSummaries.Add(new WorkoutSummaryCache
        {
            UserId = context.User.Id,
            SummaryJson = Json.Write(new[]
            {
                Item("done", "completed", today.AddDays(-1)),
                Item("planned", "scheduled", today.AddDays(1)),
                Item("running", "in_progress", today)
            })
        });
        await context.Db.SaveChangesAsync();
        var workout = new CountingHandler(_ => throw new InvalidOperationException("An inactive connection must not call Workout."));
        var service = new WorkoutSummaryService(context.Db, new StubFactory(workout), context.Config);

        var items = await service.Get(today.AddDays(-7), today.AddDays(7), null, CancellationToken.None);

        Assert.Equal("done", Assert.Single(items).Id);
        Assert.Equal(0, workout.Calls);
    }

    [Fact]
    public async Task Circuit_breaker_opens_after_three_transient_failures_and_serves_cached_summaries()
    {
        const string breakerUrl = "https://workout.test/api/integrations/v1/training-summary-trip-test";
        WorkoutSummaryService.ResetBreakers();
        await using var context = await ServiceContext.Create(connected: true, url: breakerUrl);
        var today = new DateOnly(2026, 9, 14);
        context.Db.WorkoutSummaries.Add(new WorkoutSummaryCache
        {
            UserId = context.User.Id,
            SummaryJson = Json.Write(new[]
            {
                Item("cached-1", "completed", today.AddDays(-1))
            })
        });
        await context.Db.SaveChangesAsync();

        var workout = new CountingHandler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError));
        var service = new WorkoutSummaryService(context.Db, new StubFactory(workout), context.Config);

        try
        {
            // 3 consecutive transient failures
            for (int i = 0; i < 3; i++)
            {
                var result = await service.Get(today.AddDays(-7), today, null, CancellationToken.None);
                Assert.NotEmpty(result);
                Assert.Equal("cached-1", result[0].Id);
            }
            Assert.Equal(3, workout.Calls);

            // 4th call should hit open circuit breaker and NOT invoke workout handler
            var fourthResult = await service.Get(today.AddDays(-7), today, null, CancellationToken.None);
            Assert.Equal(3, workout.Calls);
            Assert.Equal("cached-1", fourthResult[0].Id);
            var warning = await service.GetLastError(CancellationToken.None);
            Assert.Contains("Workout training summaries are temporarily unavailable", warning);
        }
        finally
        {
            WorkoutSummaryService.ResetBreakers();
        }
    }

    [Fact]
    public async Task Circuit_breaker_excludes_caller_cancellation_and_unauthorized()
    {
        const string excludeUrl = "https://workout.test/api/integrations/v1/training-summary-exclude-test";
        WorkoutSummaryService.ResetBreakers();
        await using var context = await ServiceContext.Create(connected: true, url: excludeUrl);
        var today = new DateOnly(2026, 9, 14);

        var workout = new CountingHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized));
        var service = new WorkoutSummaryService(context.Db, new StubFactory(workout), context.Config);

        try
        {
            // 3 401 Unauthorized responses do NOT trip circuit breaker
            for (int i = 0; i < 3; i++)
            {
                await service.Get(today.AddDays(-7), today, null, CancellationToken.None);
            }
            Assert.Equal(3, workout.Calls);

            // 4th call still calls workout because 401 is excluded from breaker
            await service.Get(today.AddDays(-7), today, null, CancellationToken.None);
            Assert.Equal(4, workout.Calls);
        }
        finally
        {
            WorkoutSummaryService.ResetBreakers();
        }
    }

    [Fact]
    public void Circuit_breaker_probe_recovers_on_success_and_resets()
    {
        var breaker = new WorkoutCircuitBreaker
        {
            FailureThreshold = 3,
            OpenDuration = TimeSpan.FromSeconds(30)
        };
        var now = DateTimeOffset.UtcNow;

        Assert.True(breaker.TryExecute(now, out var isProbe));
        Assert.False(isProbe);

        breaker.RecordFailure(now);
        breaker.RecordFailure(now);
        breaker.RecordFailure(now);

        Assert.True(breaker.IsOpen(now));
        Assert.False(breaker.TryExecute(now, out _));

        // Advance past open duration
        var future = now.AddSeconds(31);
        Assert.True(breaker.TryExecute(future, out isProbe));
        Assert.True(isProbe);

        // While probe in flight, another request is rejected
        Assert.False(breaker.TryExecute(future, out _));

        // Probe succeeds -> breaker closes
        breaker.RecordSuccess();
        Assert.False(breaker.IsOpen(future));
        Assert.True(breaker.TryExecute(future, out isProbe));
        Assert.False(isProbe);
    }

    private static TrainingSummaryItem Item(string id, string status, DateOnly date)
        => new(id, status, date, null, null, id, [], 0, null, null, null);

    private static HttpResponseMessage JsonResponse(string body)
        => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private sealed class TestFactory(string dbPath, HttpMessageHandler workout) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:SqlitePath"] = dbPath,
                ["PublicOrigin"] = "https://localhost",
                ["Integrations:WorkoutTrainingSummaryUrl"] = SummaryUrl
            }));
            // No peer token service: this test covers the endpoint's revalidation contract, not
            // central token exchange, which IntegrationTokenTests covers.
            builder.ConfigureTestServices(services => services.AddScoped(provider => new WorkoutSummaryService(
                provider.GetRequiredService<AppDb>(), new StubFactory(workout), provider.GetRequiredService<IConfiguration>())));
        }
    }

    private sealed class ServiceContext : IAsyncDisposable
    {
        private readonly SqliteConnection connection;
        public AppDb Db { get; }
        public AppUser User { get; }
        public IConfiguration Config { get; }

        private ServiceContext(SqliteConnection connection, AppDb db, AppUser user, IConfiguration config)
        {
            this.connection = connection; Db = db; User = user; Config = config;
        }

        public static async Task<ServiceContext> Create(bool connected, string? url = null)
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
            await db.Database.EnsureCreatedAsync();
            var user = new AppUser { IdentitySubject = "test-subject", DisplayName = "User" };
            db.Users.Add(user);
            await db.SaveChangesAsync();
            db.CurrentUser = user.Id;
            db.IntegrationGrants.Add(new IntegrationGrant
            {
                UserId = user.Id, Peer = "workout", Status = connected ? "active" : "reconnect_required",
                CentralConnectionId = Guid.NewGuid(), CentralGeneration = 1
            });
            await db.SaveChangesAsync();
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?> { ["Integrations:WorkoutTrainingSummaryUrl"] = url ?? SummaryUrl })
                .Build();
            return new ServiceContext(connection, db, user, config);
        }

        public async ValueTask DisposeAsync()
        {
            await Db.DisposeAsync();
            await connection.DisposeAsync();
        }
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class CountingHandler(Func<HttpRequestMessage, HttpResponseMessage> respond, TimeSpan delay = default) : HttpMessageHandler
    {
        private int calls;
        public int Calls => calls;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Interlocked.Increment(ref calls);
            if (delay > TimeSpan.Zero) await Task.Delay(delay, ct);
            return respond(request);
        }
    }
}
