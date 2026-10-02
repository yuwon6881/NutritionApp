using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed partial class TrainingSummaryEndpointTests
{
    [Fact]
    public async Task Cache_only_reads_never_call_the_peer_and_do_not_claim_live_success()
    {
        await using var context = await ServiceContext.Create(connected: true);
        var handler = new CountingHandler(_ => throw new Exception("Cache-only must not contact Workout"));
        var service = new WorkoutSummaryService(context.Db, new StubFactory(handler), context.Config);
        var day = new DateOnly(2026, 9, 14);
        await service.Get(day.AddDays(-7), day, null, default, cacheOnly: true);
        Assert.Equal(0, handler.Calls);
    }
}
