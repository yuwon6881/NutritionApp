using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class ProfileExpenditurePersistenceTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Corrected_profile_reseeds_the_proposal_without_rewriting_accepted_targets(bool diaryWeight)
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "profile-correction");
        db.CurrentUser = user.Id;
        var trajectory = new ExpenditureTrajectoryService(db);
        var sync = new SyncService(db, trajectory: trajectory);
        var coach = new CoachingService(db, trajectory);
        var before = new Profile
        {
            Age = 25, HeightCm = 180, WeightKg = 80, Sex = "male", ActivityLevel = ActivityLevels.Lifting,
            Goal = "maintain", TimeZone = "UTC"
        };
        await sync.Apply(new(Guid.NewGuid(), "profile", user.Id, 0,
            JsonSerializer.SerializeToElement(before, Json.Options)), default);
        var proposal = await coach.Preview(default);
        await coach.Accept(Guid.NewGuid(), proposal.Revision, default);
        var accepted = await db.Plans.SingleAsync();
        var acceptedJson = accepted.ResultJson;
        var today = RetentionService.Today(user.ProfileJson);
        if (diaryWeight)
            await sync.Apply(new(Guid.NewGuid(), "weight", Guid.NewGuid(), 0,
                JsonSerializer.SerializeToElement(new { date = today, kg = 66 }, Json.Options)), default);
        var after = before with { HeightCm = 173, WeightKg = diaryWeight ? 75 : 66 };
        await sync.Apply(new(Guid.NewGuid(), "profile", user.Id, user.ProfileRevision,
            JsonSerializer.SerializeToElement(after, Json.Options)), default);
        var corrected = await coach.Preview(default);
        Assert.Equal(2229.21875, corrected.Result.Expenditure);
        Assert.Equal(2225, corrected.Result.Calories);
        Assert.Equal(acceptedJson, (await db.Plans.SingleAsync()).ResultJson);
    }
}
