using System.Net;
using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class WorkoutAiAvailabilityTests
{
    [Theory]
    [InlineData(true, true, 2, "fresh_cached", true, 0)]
    [InlineData(true, false, 2, "stale", false, 1)]
    [InlineData(true, true, 1, "stale", false, 1)]
    [InlineData(false, true, 2, "stale", false, 0)]
    [InlineData(true, true, 2, "unavailable", false, 1, "Asia/Kuala_Lumpur")]
    public async Task Cache_coverage_is_authorized_versioned_and_range_specific(bool connected, bool covered, int version,
        string freshness, bool complete, int calls, string cachedZone = "UTC")
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "workout-ai-availability");
        db.CurrentUser = user.Id;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        db.IntegrationGrants.Add(new IntegrationGrant { UserId = user.Id, Peer = "workout", Status = connected ? "active" : "revoked",
            CentralConnectionId = Guid.NewGuid(), CentralGeneration = 1 });
        var item = new TrainingSummaryItem("session:1", "completed", today.AddDays(-1), null, null, "Lift", [], 5, 1000, null, 9,
            today.AddDays(-1), 5, 0, 0, 5, true, ["squat"]);
        db.WorkoutSummaries.Add(new WorkoutSummaryCache { UserId = user.Id, SummaryJson = Json.Write(new[] { item }),
            CoverageFrom = covered ? today.AddDays(-15) : today.AddDays(-3), CoverageTo = today.AddDays(1), CoverageTimeZone = cachedZone,
            SummarySchemaVersion = version, LastSuccessAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        using var handler = new Handler(HttpStatusCode.ServiceUnavailable);
        var result = await Service(db, handler).GetForAi(today.AddDays(-14), today, "UTC", default);
        Assert.Equal(freshness, result.Freshness);
        Assert.Equal(complete, result.CompleteCoverage);
        Assert.Equal(calls, handler.Calls);
        if (cachedZone == "UTC") Assert.Null(Assert.Single(result.Items).AverageRpe);
        else Assert.Empty(result.Items);
    }

    [Theory]
    [InlineData(HttpStatusCode.OK, true)]
    [InlineData(HttpStatusCode.Forbidden, false)]
    public async Task Fresh_empty_answer_is_distinct_from_rejected_access(HttpStatusCode status, bool complete)
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "empty-workout-ai");
        db.CurrentUser = user.Id;
        db.IntegrationGrants.Add(new IntegrationGrant { UserId = user.Id, Peer = "workout", Status = "active",
            CentralConnectionId = Guid.NewGuid(), CentralGeneration = 1 });
        await db.SaveChangesAsync();
        using var handler = new Handler(status);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var result = await Service(db, handler).GetForAi(today.AddDays(-14), today, "UTC", default);
        Assert.Empty(result.Items);
        Assert.Equal(complete, result.CompleteCoverage);
        Assert.Equal(complete ? "available" : "unavailable", result.Availability);
    }

    private static WorkoutSummaryService Service(AppDb db, Handler handler) => new(db, new Factory(handler),
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["Integrations:WorkoutTrainingSummaryUrl"] = $"https://workout.test/{Guid.NewGuid():N}" }).Build());
    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    { public HttpClient CreateClient(string name) => new(handler, disposeHandler: false); }
    private sealed class Handler(HttpStatusCode status) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            var response = new HttpResponseMessage(status) { Content = new StringContent("[]", Encoding.UTF8, "application/json") };
            response.Headers.Add("X-Workout-Summary-Version", "2");
            return Task.FromResult(response);
        }
    }
}
