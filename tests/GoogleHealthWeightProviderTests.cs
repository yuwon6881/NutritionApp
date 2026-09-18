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
}
