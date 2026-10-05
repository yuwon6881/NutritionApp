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

        // Google rejects the whole upload for a name outside its Nutrient enum.
        Assert.All(nutrients, n => Assert.Contains(n.GetProperty("nutrient").GetString(), GoogleNutrientEnum));

        var carbs = nutrients.First(n => n.GetProperty("nutrient").GetString() == "CARBOHYDRATES");
        Assert.Equal(55.4, carbs.GetProperty("quantity").GetProperty("grams").GetDouble());

        var fat = nutrients.First(n => n.GetProperty("nutrient").GetString() == "TOTAL_FAT");
        Assert.Equal(12.0, fat.GetProperty("quantity").GetProperty("grams").GetDouble());

        var fiber = nutrients.First(n => n.GetProperty("nutrient").GetString() == "DIETARY_FIBER");
        Assert.Equal(6.5, fiber.GetProperty("quantity").GetProperty("grams").GetDouble());
    }

    /// <summary>Nutrient values accepted by Google Health API v4 (google.devicesandservices.health.v4.Nutrient).</summary>
    private static readonly string[] GoogleNutrientEnum =
    [
        "CALCIUM", "CARBOHYDRATES", "CHOLESTEROL", "CHROMIUM", "COPPER", "DIETARY_FIBER", "FOLATE", "IODINE", "IRON",
        "MAGNESIUM", "MANGANESE", "MOLYBDENUM", "NIACIN", "PANTOTHENIC_ACID", "PHOSPHORUS", "POTASSIUM", "PROTEIN",
        "SATURATED_FAT", "SELENIUM", "SODIUM", "SUGAR", "THIAMINE", "TOTAL_FAT", "UNSATURATED_FAT", "VANADIUM",
        "VITAMIN_A", "VITAMIN_B12", "VITAMIN_B6", "VITAMIN_C", "VITAMIN_D", "VITAMIN_E", "VITAMIN_K", "ZINC"
    ];

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
