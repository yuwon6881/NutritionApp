using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// Intake-step detection compares a seven-day block before each candidate date, and candidates start
/// six days before the 28-day window, so the services must load diary history beyond the window itself.
public sealed class IntakeStepHistoryTests
{
    [Fact]
    public async Task A_step_shortly_before_the_window_is_detected_by_the_coaching_preview()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options;
        await using var db = new AppDb(options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "intake-step");
        user.ProfileJson = Json.Write(new Profile
        {
            Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4,
            Goal = "maintain", Maintenance = 2500, TimeZone = "UTC"
        });
        user.ProfileRevision = 1;
        user.TrajectoryRevision = 1;
        var today = RetentionService.Today(user.ProfileJson);
        var step = today.AddDays(-30);
        db.CurrentUser = user.Id;
        for (var date = today.AddDays(-45); date < today; date = date.AddDays(1))
        {
            db.Entries.Add(new DiaryEntry
            {
                Id = Guid.NewGuid(), UserId = user.Id, Date = date, Name = "Meal",
                Calories = date < step ? 2000 : 2600
            });
            db.Weights.Add(new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = date, Kg = 80 });
        }
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var preview = await new CoachingService(db, new ExpenditureTrajectoryService(db)).Preview(default);

        Assert.Contains("your intake changed", preview.Result.Explanation);
    }

    [Fact]
    public void Loading_HistoryDays_matches_loading_all_history()
    {
        var today = new DateOnly(2026, 10, 5);
        var step = today.AddDays(-30);
        var all = Expenditure.EstimateDaily(Days(today.AddDays(-60), today, step), [], 2500, today);
        var bounded = Expenditure.EstimateDaily(Days(today.AddDays(-Expenditure.HistoryDays), today, step), [], 2500, today);
        Assert.Equal(all.Reason, bounded.Reason);
        Assert.Equal(all.Evidence.WindowDays, bounded.Evidence.WindowDays);
    }

    private static List<NutritionDay> Days(DateOnly from, DateOnly today, DateOnly step)
    {
        var days = new List<NutritionDay>();
        for (var date = from; date < today; date = date.AddDays(1))
            days.Add(new NutritionDay(date, "complete", date < step ? 2000 : 2600));
        return days;
    }
}
