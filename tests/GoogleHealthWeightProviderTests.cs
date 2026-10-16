using System.Net;
using System.Text.Json;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class GoogleHealthWeightProviderTests
{
    [Fact]
    public async Task CreateUsesGoogleHealthWeightDataPointShape()
    {
        var handler = new CaptureHandler();
        using var http = new HttpClient(handler);

        await GoogleHealthWeightProvider.CreateAsync(
            http,
            "access-token",
            new GoogleHealthWeightDataPoint(72500, "2026-09-18T12:00:00+08:00"),
            default);

        using var body = JsonDocument.Parse(handler.Body!);
        var weight = body.RootElement.GetProperty("weight");
        Assert.Equal(72500, weight.GetProperty("weightGrams").GetInt64());
        Assert.Equal("2026-09-18T12:00:00+08:00", weight.GetProperty("sampleTime").GetProperty("physicalTime").GetString());
        Assert.Equal("28800s", weight.GetProperty("sampleTime").GetProperty("utcOffset").GetString());
        Assert.False(weight.TryGetProperty("notes", out var notes) && notes.ValueKind != JsonValueKind.Null);
    }

    [Fact]
    public async Task CreateTreatsAConnectionFailureAsTransientNotUnknown()
    {
        // The request never reached Google (DNS/connect/TLS never completed), so there is no
        // duplicate-create risk: this must retry like any other transient failure, not become "unknown".
        using var http = new HttpClient(new ThrowingHandler(new HttpRequestException(HttpRequestError.ConnectionError, "refused")));

        var ex = await Assert.ThrowsAsync<GoogleHealthWeightProviderException>(() =>
            GoogleHealthWeightProvider.CreateAsync(http, "access-token", new GoogleHealthWeightDataPoint(72500, "2026-09-18T12:00:00+08:00"), default));

        Assert.True(ex.Transient);
        Assert.False(ex.UnknownCreate);
    }

    [Fact]
    public async Task CreateStillTreatsAnAmbiguousTransportFailureAsUnknown()
    {
        // The connection was established but the response was lost mid-flight: Google may already
        // have created the data point, so this must stay "unknown" rather than retry automatically.
        using var http = new HttpClient(new ThrowingHandler(new HttpRequestException(HttpRequestError.ResponseEnded, "ended")));

        var ex = await Assert.ThrowsAsync<GoogleHealthWeightProviderException>(() =>
            GoogleHealthWeightProvider.CreateAsync(http, "access-token", new GoogleHealthWeightDataPoint(72500, "2026-09-18T12:00:00+08:00"), default));

        Assert.True(ex.UnknownCreate);
        Assert.False(ex.Transient);
    }

    private sealed class CaptureHandler : HttpMessageHandler
    {
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"name\":\"operations/test\",\"done\":false}")
            };
        }
    }

    private sealed class ThrowingHandler(HttpRequestException exception) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => throw exception;
    }
}
