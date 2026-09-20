using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class GoogleHealthNutritionSyncTests
{
    [Theory]
    [InlineData("07:30", "BREAKFAST")]
    [InlineData("10:59", "BREAKFAST")]
    [InlineData("11:00", "LUNCH")]
    [InlineData("14:30", "LUNCH")]
    [InlineData("15:00", "SNACK")]
    [InlineData("17:45", "SNACK")]
    [InlineData("18:00", "DINNER")]
    [InlineData("21:00", "DINNER")]
    [InlineData("02:00", "DINNER")]
    [InlineData(null, "MEAL_TYPE_UNSPECIFIED")]
    [InlineData("invalid", "MEAL_TYPE_UNSPECIFIED")]
    public void MealTypeIsInferredFromTime(string? time, string expectedMealType)
    {
        Assert.Equal(expectedMealType, GoogleHealthNutritionSyncService.InferMealType(time));
    }

    [Fact]
    public void BuildDataPointProducesValidPayload()
    {
        var dp = GoogleHealthNutritionSyncService.BuildDataPoint(
            new DateOnly(2026, 9, 18),
            "12:30",
            "Chicken Rice",
            650.0,
            40.0,
            18.0,
            75.0,
            3.5,
            "Asia/Singapore");

        Assert.Equal("2026-09-18T12:30:00+08:00", dp.StartTime);
        Assert.Equal("2026-09-18T12:45:00+08:00", dp.EndTime);
        Assert.Equal("Chicken Rice", dp.FoodDisplayName);
        Assert.Equal("LUNCH", dp.MealType);
        Assert.Equal(650.0, dp.CaloriesKcal);
        Assert.Equal(40.0, dp.ProteinGrams);
        Assert.Equal(18.0, dp.FatGrams);
        Assert.Equal(75.0, dp.CarbsGrams);
        Assert.Equal(3.5, dp.FiberGrams);
    }

    [Fact]
    public async Task NutritionMutationQueuesOnlyWhenTheConnectionIsEnabled()
    {
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options)
        {
            CurrentUser = Guid.NewGuid()
        };
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        db.Users.Add(new AppUser { Id = db.CurrentUser.Value, DisplayName = "queue-user", IdentitySubject = "queue-subject" });
        db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = db.CurrentUser.Value,
            GoogleIdHash = "queue-google",
            EncryptedRefreshToken = "refresh",
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthNutritionSyncService.NutritionScope }),
            NutritionSyncEnabled = true,
            Status = "connected"
        });
        await db.SaveChangesAsync();

        var google = new GoogleHealthService(new HttpClient(), db, new TestKms(), new ConfigurationBuilder().Build());
        var nutritionSync = new GoogleHealthNutritionSyncService(db, google, new HttpClient());
        var sync = new SyncService(db, nutritionSync: nutritionSync);
        var entryId = Guid.NewGuid();
        var mutation = new Mutation(
            Guid.NewGuid(),
            "entry",
            entryId,
            0,
            JsonSerializer.SerializeToElement(new
            {
                date = "2026-09-18",
                time = "12:30",
                name = "Grilled Salmon",
                calories = 520.0,
                protein = 45.0,
                fat = 22.0,
                carbs = 10.0,
                fiber = 2.0
            }));

        await sync.Apply(mutation, default);

        var work = await db.GoogleHealthNutritionSyncWork.SingleAsync(x => x.EntryId == entryId);
        Assert.Equal("pending", work.ProcessingState);
        Assert.Equal(520.0, work.DesiredCalories);
        Assert.Equal("Grilled Salmon", work.DesiredName);
        Assert.Equal("12:30", work.DesiredTime);
        Assert.Equal("LUNCH", GoogleHealthNutritionSyncService.InferMealType(work.DesiredTime));
        Assert.Equal(45.0, work.DesiredProtein);
    }

    private sealed class TestKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext);
    }
}
