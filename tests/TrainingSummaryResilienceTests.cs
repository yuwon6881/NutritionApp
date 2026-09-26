using System.Net;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed partial class TrainingSummaryEndpointTests
{
    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    public async Task Non_transient_http_failures_keep_cached_history_without_opening_breaker(HttpStatusCode status)
    {
        var url = $"https://workout.test/{Guid.NewGuid():N}";
        await using var context = await ServiceContext.Create(true, url);
        var date = new DateOnly(2026, 9, 27);
        context.Db.WorkoutSummaries.Add(new Nutrition.Api.Data.WorkoutSummaryCache
        {
            UserId = context.User.Id,
            SummaryJson = Json.Write(new[] { Item("cached", "completed", date) })
        });
        await context.Db.SaveChangesAsync();
        var handler = new CountingHandler(_ => new HttpResponseMessage(status));
        var service = new WorkoutSummaryService(context.Db, new StubFactory(handler), context.Config);
        for (var i = 0; i < 4; i++)
            Assert.Equal("cached", Assert.Single(await service.Get(date, date, null, default)).Id);
        Assert.Equal(4, handler.Calls);
        Assert.False(WorkoutSummaryService.GetBreaker(url).IsOpen(DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task Caller_cancellation_releases_the_half_open_probe()
    {
        var url = $"https://workout.test/{Guid.NewGuid():N}";
        await using var context = await ServiceContext.Create(true, url);
        var now = DateTimeOffset.UtcNow;
        var breaker = WorkoutSummaryService.GetBreaker(url);
        for (var i = 0; i < 3; i++) breaker.RecordFailure(now);
        var clock = new ProbeClock(now.AddSeconds(31));
        var handler = new CountingHandler(_ => JsonResponse("[]"), TimeSpan.FromSeconds(1));
        var service = new WorkoutSummaryService(context.Db, new StubFactory(handler), context.Config);
        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        var date = new DateOnly(2026, 9, 27);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.Get(date, date, null, cancel.Token, timeProvider: clock));
        Assert.Equal(1, handler.Calls);
        Assert.True(breaker.TryExecute(clock.GetUtcNow(), out var isProbe));
        Assert.True(isProbe);
        Assert.False(breaker.TryExecute(clock.GetUtcNow(), out _));
        breaker.ReleaseProbe();
    }

    [Fact]
    public async Task Failed_account_token_exchange_does_not_open_the_peer_breaker()
    {
        var url = $"https://workout.test/{Guid.NewGuid():N}";
        await using var context = await ServiceContext.Create(true, url);
        var config = new ConfigurationBuilder().AddConfiguration(context.Config)
            .AddInMemoryCollection(new Dictionary<string,string?>
            {
                ["Identity:Authority"] = "https://identity.test",
                ["Identity:ClientId"] = "nutrition", ["Identity:ClientSecret"] = "test-secret"
            }).Build();
        var factory = new StubFactory(new CountingHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized)));
        var tokens = new IntegrationTokenService(context.Db, factory, config, new UnusedValidator(), new UnusedKms());
        var service = new WorkoutSummaryService(context.Db, factory, config, tokens);
        var date = new DateOnly(2026, 9, 27);
        for (var i = 0; i < 4; i++) await service.Get(date, date, null, default);
        Assert.False(WorkoutSummaryService.GetBreaker(url).IsOpen(DateTimeOffset.UtcNow));
        Assert.True(WorkoutSummaryService.GetBreaker(url).TryExecute(DateTimeOffset.UtcNow, out var isProbe));
        Assert.False(isProbe);
    }

    private sealed class ProbeClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class UnusedValidator : ISharedAccessTokenValidator
    {
        public Task<ValidatedAccessToken> RequireAccessToken(string token, string scope, CancellationToken ct)
            => throw new InvalidOperationException("Failed token exchange must not validate a token.");
    }

    private sealed class UnusedKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => throw new InvalidOperationException();
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => throw new InvalidOperationException();
    }
}
