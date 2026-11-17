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
        var today = ProfileClock.Today(user.ProfileJson);
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

    [Fact]
    public async Task A_later_window_rebuild_does_not_reseed_a_corrected_profile_from_the_pre_correction_snapshot()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "profile-correction-seed");
        db.CurrentUser = user.Id;
        var trajectory = new ExpenditureTrajectoryService(db);
        var sync = new SyncService(db, trajectory: trajectory);
        var before = new Profile
        {
            Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4,
            Goal = "maintain", Maintenance = 3500, TimeZone = "UTC"
        };
        await sync.Apply(new(Guid.NewGuid(), "profile", user.Id, 0,
            JsonSerializer.SerializeToElement(before, Json.Options)), default);
        var today = ProfileClock.Today(user.ProfileJson);
        var start = today.AddDays(-(ExpenditureTrajectoryService.BackfillDays - 1));
        // Yesterday's window left a snapshot just before today's, computed from the old profile.
        db.ExpenditureEstimates.Add(new DailyExpenditureEstimate
        {
            UserId = user.Id, Date = start.AddDays(-1), Expenditure = 3500,
            SourceRevision = user.TrajectoryRevision, AlgorithmVersion = ExpenditureTrajectory.AlgorithmVersion
        });
        await db.SaveChangesAsync();

        await sync.Apply(new(Guid.NewGuid(), "profile", user.Id, user.ProfileRevision,
            JsonSerializer.SerializeToElement(before with { Maintenance = 2500 }, Json.Options)), default);
        var corrected = await TodayExpenditure(db, today);
        Assert.Equal(2500, corrected);

        await trajectory.RebuildFrom(start, user.TrajectoryRevision, default);
        Assert.Equal(corrected, await TodayExpenditure(db, today));
    }

    [Fact]
    public async Task A_partial_rebuild_leaves_the_whole_window_on_the_current_revision()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "partial-rebuild-revision");
        db.CurrentUser = user.Id;
        var trajectory = new ExpenditureTrajectoryService(db);
        var sync = new SyncService(db, trajectory: trajectory);
        var profile = new Profile
        {
            Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4,
            Goal = "maintain", Maintenance = 2500, TimeZone = "UTC"
        };
        await sync.Apply(new(Guid.NewGuid(), "profile", user.Id, 0,
            JsonSerializer.SerializeToElement(profile, Json.Options)), default);
        var today = ProfileClock.Today(user.ProfileJson);
        var revision = await sync.Apply(new(Guid.NewGuid(), "entry", Guid.NewGuid(), 0,
            JsonSerializer.SerializeToElement(new { date = today.AddDays(-1), name = "Rice", calories = 500, quantity = 1, unit = "serving" }, Json.Options)), default);

        // Read straight from the table: EnsureThroughToday would hide a stale window by rebuilding it.
        var rows = await db.ExpenditureEstimates.AsNoTracking().ToListAsync();
        Assert.Equal(ExpenditureTrajectoryService.BackfillDays, rows.Count);
        Assert.All(rows, row => Assert.Equal(revision, row.SourceRevision));
    }

    private static async Task<double?> TodayExpenditure(AppDb db, DateOnly today)
        => (await db.ExpenditureEstimates.AsNoTracking().SingleAsync(item => item.Date == today)).Expenditure;
}
