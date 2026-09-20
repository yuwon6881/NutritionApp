using System.Net;
using System.Text.Json;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class GoogleHealthNutritionProviderTests
{
    [Fact]
    public async Task CreateUsesGoogleHealthNutritionDataPointShape()
    {
        var handler = new CaptureHandler();
        using var http = new HttpClient(handler);

        var dataPoint = new GoogleHealthNutritionDataPoint(
            "2026-09-18T08:30:00+08:00",
            "2026-09-18T08:45:00+08:00",
            "Oatmeal & Protein Shake",
            "BREAKFAST",
            450.5,
            35.2,
            12.0,
            55.4,
            6.5);

        await GoogleHealthNutritionProvider.CreateAsync(
            http,
            "access-token",
            dataPoint,
            default);

        using var body = JsonDocument.Parse(handler.Body!);
        var log = body.RootElement.GetProperty("nutritionLog");
        Assert.Equal("2026-09-18T08:30:00+08:00", log.GetProperty("interval").GetProperty("startTime").GetString());
        Assert.Equal("2026-09-18T08:45:00+08:00", log.GetProperty("interval").GetProperty("endTime").GetString());
        Assert.Equal("Oatmeal & Protein Shake", log.GetProperty("foodDisplayName").GetString());
        Assert.Equal("BREAKFAST", log.GetProperty("mealType").GetString());
        Assert.Equal(450.5, log.GetProperty("energy").GetProperty("kcal").GetDouble());

        var nutrients = log.GetProperty("nutrients").EnumerateArray().ToList();
        Assert.Equal(4, nutrients.Count);

        var protein = nutrients.First(n => n.GetProperty("nutrient").GetString() == "PROTEIN");
        Assert.Equal(35.2, protein.GetProperty("quantity").GetProperty("grams").GetDouble());

        var carbs = nutrients.First(n => n.GetProperty("nutrient").GetString() == "TOTAL_CARBOHYDRATE");
        Assert.Equal(55.4, carbs.GetProperty("quantity").GetProperty("grams").GetDouble());

        var fat = nutrients.First(n => n.GetProperty("nutrient").GetString() == "TOTAL_FAT");
        Assert.Equal(12.0, fat.GetProperty("quantity").GetProperty("grams").GetDouble());

        var fiber = nutrients.First(n => n.GetProperty("nutrient").GetString() == "DIETARY_FIBER");
        Assert.Equal(6.5, fiber.GetProperty("quantity").GetProperty("grams").GetDouble());
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
