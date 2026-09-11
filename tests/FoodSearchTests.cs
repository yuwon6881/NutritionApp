using System.Net;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class FoodSearchTests
{
    [Fact]
    public async Task Search_without_a_configured_key_reports_the_disabled_feature_and_its_alternatives()
    {
        using var client = new HttpClient(new Handler(_ => throw new InvalidOperationException("The provider must not be called without a key.")));
        var service = new FoodSearchService(client, Config(null), new MemoryCache(new MemoryCacheOptions { SizeLimit = 64 }));

        var error = await Assert.ThrowsAsync<DomainException>(() => service.Search("nasi", default));

        Assert.Equal(503, error.Status);
        Assert.Equal("Ingredient search is not configured. Use custom food, recent foods, or AI describe.", error.Message);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests, 429, "hourly allowance")]
    [InlineData(HttpStatusCode.Unauthorized, 503, "rejected this deployment key")]
    [InlineData(HttpStatusCode.Forbidden, 503, "rejected this deployment key")]
    [InlineData(HttpStatusCode.InternalServerError, 503, "temporarily unavailable")]
    [InlineData(HttpStatusCode.BadGateway, 503, "temporarily unavailable")]
    public void Upstream_failures_keep_their_own_status_and_remedy(HttpStatusCode upstream, int status, string remedy)
    {
        var error = FoodSearchService.SearchUnavailable(upstream);

        Assert.Equal(status, error.Status);
        Assert.Contains(remedy, error.Message);
    }

    [Fact]
    public void A_rejected_key_is_not_reported_as_a_passing_outage()
    {
        Assert.NotEqual(
            FoodSearchService.SearchUnavailable(HttpStatusCode.ServiceUnavailable).Message,
            FoodSearchService.SearchUnavailable(HttpStatusCode.Forbidden).Message);
    }

    private static IConfiguration Config(string? key) => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { ["Usda:ApiKey"] = key })
        .Build();

    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(respond(request));
    }
}
