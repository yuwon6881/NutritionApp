using System.Net;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// <summary>
/// The search gate paces Open Food Facts with process-wide state, so these two behaviours are
/// asserted in one ordered test rather than as separate cases that could interleave.
/// </summary>
public sealed class FoodSearchGateTests
{
    private sealed class Stub(HttpStatusCode status) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent("{}") });
        }
    }

    private static FoodSearchService Service(Stub stub)
        => new(new HttpClient(stub), new MemoryCache(new MemoryCacheOptions { SizeLimit = 256 }));

    [Fact]
    public async Task A_shed_search_returns_its_slot_but_a_busy_one_holds_the_wait()
    {
        // A shed search must not keep the slot: the retry its message asks for has to reach Open
        // Food Facts rather than be answered by our own rate limit.
        var shed = new Stub(HttpStatusCode.ServiceUnavailable);
        var shedService = Service(shed);
        var first = await Assert.ThrowsAsync<DomainException>(() => shedService.Search("nasi goreng", default));
        var retry = await Assert.ThrowsAsync<DomainException>(() => shedService.Search("nasi goreng", default));

        Assert.Equal(503, first.Status);
        Assert.Equal(503, retry.Status);
        Assert.Equal(2, shed.Calls);

        // An upstream 429 is the opposite: it is a real instruction to back off, so the next search
        // is refused locally without spending another request on a service that just said no.
        var busy = new Stub(HttpStatusCode.TooManyRequests);
        var busyService = Service(busy);
        var refused = await Assert.ThrowsAsync<DomainException>(() => busyService.Search("nasi goreng", default));
        var held = await Assert.ThrowsAsync<DomainException>(() => busyService.Search("chicken rice", default));

        Assert.Equal(429, refused.Status);
        Assert.Contains("busy at Open Food Facts", refused.Message);
        Assert.Equal(429, held.Status);
        Assert.Contains("Please wait a moment", held.Message);
        Assert.Equal(1, busy.Calls);
    }
}
