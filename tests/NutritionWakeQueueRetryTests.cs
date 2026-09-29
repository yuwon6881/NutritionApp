using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// Scheduling a reminder wake-up is retried at once when Cloud Tasks or the network hiccups, so a
/// momentary failure does not cost a reminder.
public sealed class NutritionWakeQueueRetryTests
{
    private static readonly DateTimeOffset At = new(2026, 9, 28, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task A_temporary_cloud_tasks_error_is_retried_and_the_wake_is_scheduled()
    {
        var handler = new Handler(HttpStatusCode.ServiceUnavailable, HttpStatusCode.OK);

        var scheduled = await Queue(handler).EnsureWakeAsync(At, default);

        Assert.True(scheduled);
        Assert.Equal(2, handler.Requests.Count);
        // Both attempts name the same task, so a retry after a lost response cannot schedule a second wake.
        Assert.All(handler.Bodies, body => Assert.Contains("checkin-wake-202609280000", body));
    }

    [Fact]
    public async Task A_network_failure_is_retried()
    {
        var handler = new Handler(new HttpRequestException("connection reset"), HttpStatusCode.OK);

        Assert.True(await Queue(handler).EnsureWakeAsync(At, default));
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task A_credential_failure_is_retried()
    {
        var handler = new Handler(HttpStatusCode.OK);
        var calls = 0;
        var queue = Queue(handler, token: _ => ++calls == 1 ? throw new InvalidOperationException("metadata server unavailable") : Task.FromResult("token"));

        Assert.True(await queue.EnsureWakeAsync(At, default));
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task Repeated_failures_stop_after_three_attempts_and_report_failure_without_throwing()
    {
        var handler = new Handler(HttpStatusCode.ServiceUnavailable, HttpStatusCode.TooManyRequests, HttpStatusCode.BadGateway, HttpStatusCode.OK);

        Assert.False(await Queue(handler).EnsureWakeAsync(At, default));
        Assert.Equal(3, handler.Requests.Count);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.NotFound)]
    public async Task A_permanent_error_is_not_retried(HttpStatusCode status)
    {
        var handler = new Handler(status, HttpStatusCode.OK);

        Assert.False(await Queue(handler).EnsureWakeAsync(At, default));
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task An_existing_task_for_that_minute_counts_as_scheduled_without_a_retry()
    {
        var handler = new Handler(HttpStatusCode.Conflict);

        Assert.True(await Queue(handler).EnsureWakeAsync(At, default));
        Assert.Single(handler.Requests);
    }

    private static CloudTasksNutritionWakeQueue Queue(Handler handler, Func<CancellationToken, Task<string>>? token = null)
        => new(
            new HttpClient(handler),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CloudTasks:ProjectId"] = "project",
                ["CloudTasks:Location"] = "asia-southeast1",
                ["CloudTasks:Queue"] = "nutrition-check-in",
                ["CloudTasks:TargetUrl"] = "https://nutrition.example.com/internal/nutrition-check-in-dispatch",
                ["Cleanup:Token"] = "cleanup-token"
            }).Build(),
            NullLogger<CloudTasksNutritionWakeQueue>.Instance,
            token ?? (_ => Task.FromResult("token")),
            (_, _) => Task.CompletedTask);

    private sealed class Handler(params object[] script) : HttpMessageHandler
    {
        private int next;
        public List<HttpRequestMessage> Requests { get; } = [];
        public List<string> Bodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request);
            Bodies.Add(request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct));
            var step = script[Math.Min(next++, script.Length - 1)];
            if (step is Exception failure) throw failure;
            return new HttpResponseMessage((HttpStatusCode)step);
        }
    }
}
