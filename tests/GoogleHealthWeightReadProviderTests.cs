using System.Text.Json;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class GoogleHealthWeightReadProviderTests
{
    [Fact]
    public async Task Refuses_a_truncated_read_instead_of_importing_a_potentially_wrong_daily_sample()
    {
        using var handler = new UnendingPages();
        using var http = new HttpClient(handler);
        var now = DateTimeOffset.UtcNow;
        var failure = await Assert.ThrowsAsync<GoogleHealthWeightProviderException>(() =>
            GoogleHealthWeightReadProvider.ListAsync(http, "token", now.AddDays(-31), now, default));
        Assert.Equal("provider_unavailable", failure.Category);
        Assert.Equal(5, handler.Calls);
    }

    private sealed class UnendingPages : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
            {
                Content = new StringContent("""{"dataPoints":[],"nextPageToken":"more"}""")
            });
        }
    }

    [Fact]
    public void Parses_weight_points_with_offset_source_and_page_token()
    {
        using var document = JsonDocument.Parse("""
            {
              "dataPoints": [{
                "name": "users/me/dataTypes/weight/dataPoints/abc-1",
                "dataSource": { "application": { "packageName": "com.scale", "googleWebClientId": "client-1" } },
                "weight": {
                  "sampleTime": { "physicalTime": "2026-09-30T23:15:00Z", "utcOffset": "28800s" },
                  "weightGrams": 80450.5
                }
              }],
              "nextPageToken": "page-2"
            }
            """);

        var readings = GoogleHealthWeightReadProvider.Parse(document.RootElement, out var next);

        var reading = Assert.Single(readings);
        Assert.Equal("users/me/dataTypes/weight/dataPoints/abc-1", reading.ResourceName);
        Assert.Equal(new DateTimeOffset(2026, 9, 30, 23, 15, 0, TimeSpan.Zero), reading.PhysicalTime);
        Assert.Equal(TimeSpan.FromHours(8), reading.UtcOffset);
        Assert.Equal(80450.5, reading.WeightGrams);
        Assert.Equal("client-1", reading.WebClientId);
        Assert.Equal("page-2", next);
    }

    [Fact]
    public void Skips_incomplete_points_and_accepts_string_encoded_grams()
    {
        using var document = JsonDocument.Parse("""
            {
              "dataPoints": [
                { "name": "users/me/dataTypes/weight/dataPoints/no-weight" },
                { "name": "users/me/dataTypes/weight/dataPoints/no-time", "weight": { "weightGrams": 70000 } },
                { "weight": { "sampleTime": { "physicalTime": "2026-09-30T00:00:00Z" }, "weightGrams": 70000 } },
                { "name": "users/me/dataTypes/weight/dataPoints/string", "weight": { "sampleTime": { "physicalTime": "2026-09-30T00:00:00Z" }, "weightGrams": "71000" } }
              ]
            }
            """);

        var readings = GoogleHealthWeightReadProvider.Parse(document.RootElement, out var next);

        var reading = Assert.Single(readings);
        Assert.Equal(71000, reading.WeightGrams);
        Assert.Null(reading.UtcOffset);
        Assert.Null(reading.WebClientId);
        Assert.Null(next);
    }

    [Theory]
    [InlineData("28800s", 480)]
    [InlineData("-18000s", -300)]
    [InlineData("19800.0s", 330)]
    [InlineData("0s", 0)]
    public void Duration_offsets_become_whole_minutes(string value, int minutes)
        => Assert.Equal(TimeSpan.FromMinutes(minutes), GoogleHealthWeightReadProvider.ParseDuration(value));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("8h")]
    [InlineData("99999s")]
    [InlineData("NaNs")]
    [InlineData("Infinitys")]
    public void Unusable_offsets_are_unknown(string? value)
        => Assert.Null(GoogleHealthWeightReadProvider.ParseDuration(value));

    [Fact]
    public void A_reading_without_an_offset_uses_the_profile_zone()
    {
        var reading = new GoogleHealthWeightReading("users/me/dataTypes/weight/dataPoints/x",
            new DateTimeOffset(2026, 9, 30, 20, 0, 0, TimeSpan.Zero), null, 70000, null);
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Kuala_Lumpur");

        var plan = GoogleHealthWeightImportPlanner.Plan([reading], new DateOnly(2026, 10, 1), zone,
            new HashSet<DateOnly>(), new HashSet<string>(), null);

        Assert.Equal(new DateOnly(2026, 10, 1), Assert.Single(plan).Date);
    }
}
