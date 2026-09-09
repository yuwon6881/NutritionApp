using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using System.Text.Json;
using Xunit;

namespace Nutrition.Tests;

public sealed class CheckInTests
{
    [Theory]
    [InlineData("2026-09-07", "2026-09-07")]
    [InlineData("2026-09-08", "2026-09-07")]
    [InlineData("2026-09-13", "2026-09-07")]
    public void Week_start_is_monday(string input, string expected)
    {
        Assert.Equal(DateOnly.Parse(expected), CheckInWeek.WeekStart(DateOnly.Parse(input)));
    }

    [Theory]
    [InlineData(0, "2026-09-06", "2026-09-13")]
    [InlineData(1, "2026-09-07", "2026-09-14")]
    [InlineData(2, "2026-09-08", "2026-09-15")]
    [InlineData(3, "2026-09-09", "2026-09-16")]
    [InlineData(4, "2026-09-03", "2026-09-10")]
    [InlineData(5, "2026-09-04", "2026-09-11")]
    [InlineData(6, "2026-09-05", "2026-09-12")]
    public void Selected_weekday_periods_have_stable_boundaries(int weekday, string expectedStart, string expectedNext)
    {
        var date = new DateOnly(2026, 9, 9);
        Assert.Equal(DateOnly.Parse(expectedStart), CheckInWeek.PeriodStart(date, weekday));
        Assert.Equal(DateOnly.Parse(expectedNext), CheckInWeek.NextOccurrenceAfter(date, weekday));
    }

    [Fact]
    public async Task Monday_check_in_is_available_and_a_decline_hides_it_until_the_next_week()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await NewUser(db);
        var today = RetentionService.Today(user.ProfileJson);
        var plan = AddPlan(user, today.AddDays(-7));
        db.Plans.Add(plan);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        db.CurrentUser = user.Id;

        var coach = new CoachingService(db);
        var preview = await coach.Preview(default);

        Assert.Equal(CheckInWeek.WeekStart(today), preview.WeekStart);
        Assert.Equal(CheckInWeek.NextCheckIn(plan.Date), preview.NextCheckIn);
        Assert.True(preview.CanAccept);

        var id = Guid.NewGuid();
        var declined = await coach.Decline(id, preview.Revision, default);
        Assert.Equal(preview.WeekStart, declined.WeekStart);
        Assert.Equal("declined", declined.Decision);
        Assert.False((await coach.Preview(default)).CanAccept);

        var replay = await coach.Decline(id, preview.Revision, default);
        Assert.Equal(declined.Id, replay.Id);
        var conflict = await Assert.ThrowsAsync<DomainException>(() => coach.Decline(id, preview.Revision + 1, default));
        Assert.Equal(409, conflict.Status);
    }

    [Fact]
    public async Task A_profile_revision_change_keeps_the_proposal_available_immediately()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await NewUser(db);
        var today = RetentionService.Today(user.ProfileJson);
        db.Plans.Add(AddPlan(user, today.AddDays(-7)));
        await db.SaveChangesAsync();
        db.CurrentUser = user.Id;
        var coach = new CoachingService(db);
        var first = await coach.Preview(default);
        await coach.Decline(Guid.NewGuid(), first.Revision, default);

        user = await db.Users.SingleAsync(u => u.Id == user.Id);
        user.ProfileJson = Json.Write(Json.Read<Profile>(user.ProfileJson) with { Activity = 1.6 });
        user.ProfileRevision++;
        user.Revision++;
        await db.SaveChangesAsync();

        var changed = await coach.Preview(default);
        Assert.True(changed.CanAccept);
        Assert.NotEqual(first.Revision, changed.Revision);
    }

    [Fact]
    public async Task A_settings_only_change_waits_until_the_next_selected_occurrence()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await NewUser(db);
        var today = RetentionService.Today(user.ProfileJson);
        db.Plans.Add(AddPlan(user, today));
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        db.CurrentUser = user.Id;

        var sync = new SyncService(db);
        var settingsRevision = await sync.Apply(new(Guid.NewGuid(), "settings", user.Id, user.CoachingSettingsRevision,
            JsonSerializer.SerializeToElement(new { checkInWeekday = 5 }, Json.Options)), default);
        Assert.Equal(settingsRevision, (await db.Users.SingleAsync(item => item.Id == user.Id)).CoachingSettingsRevision);

        var preview = await new CoachingService(db).Preview(default);
        Assert.False(preview.CanAccept);
        Assert.Equal(CheckInWeek.NextOccurrenceAfter(today, 5), preview.NextCheckIn);
        Assert.Contains("check-in day changed", preview.HoldReason);
    }

    [Fact]
    public async Task Goal_completion_waits_for_trend_and_replays_idempotently()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await NewUser(db);
        var profile = Json.Read<Profile>(user.ProfileJson) with
        {
            Goal = "lose", PhaseMode = "weight", PhaseStartWeightKg = 80, TargetWeightKg = 75,
            EnergyAdjustmentPercent = 15
        };
        user.ProfileJson = Json.Write(profile);
        user.ProfileRevision++;
        user.Revision++;
        var today = RetentionService.Today(user.ProfileJson);
        db.Weights.AddRange(
            new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = today.AddDays(-3), Kg = 80 },
            new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = today.AddDays(-2), Kg = 80 },
            new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = today.AddDays(-1), Kg = 74.8 });
        await db.SaveChangesAsync();

        var coach = new CoachingService(db);
        var waitId = Guid.NewGuid();
        var waitRevision = user.Revision;
        var waiting = await coach.CompleteGoal(waitId, waitRevision, "await-trend", default);
        Assert.Equal("await-trend", waiting.Decision);
        Assert.Equal("scale", waiting.ReachedBy);
        Assert.Equal(waiting.Id, (await coach.CompleteGoal(waitId, waitRevision, "await-trend", default)).Id);
        var conflict = await Assert.ThrowsAsync<DomainException>(() => coach.CompleteGoal(waitId, waitRevision, "completed", default));
        Assert.Equal(409, conflict.Status);

        foreach (var weight in db.Weights) weight.Kg = 74.8;
        await db.SaveChangesAsync();
        var currentRevision = (await db.Users.SingleAsync(u => u.Id == user.Id)).Revision;
        var completeId = Guid.NewGuid();
        var completed = await coach.CompleteGoal(completeId, currentRevision, "completed", default);
        Assert.Equal("completed", completed.Decision);
        Assert.Equal("trend", completed.ReachedBy);
        Assert.Equal(completed.Id, (await coach.CompleteGoal(completeId, currentRevision, "completed", default)).Id);
    }

    private static async Task<AppUser> NewUser(AppDb db)
    {
        var user = await new AuthService(db, new ConfigurationBuilder().Build())
            .Register("checkin-user", "a long test password", default);
        db.CurrentUser = user.Id;
        user.ProfileJson = Json.Write(new Profile
        {
            Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4,
            Goal = "maintain", Maintenance = 2500, TimeZone = "UTC"
        });
        user.ProfileRevision = 1;
        user.Revision = 1;
        await db.SaveChangesAsync();
        return user;
    }

    private static AcceptedPlan AddPlan(AppUser user, DateOnly date)
    {
        var result = new CoachResult(true, false, 2500, 2500, 150, 83.3, 312.5, "accepted")
        {
            EffectiveGoal = "maintain"
        };
        return new AcceptedPlan
        {
            Id = Guid.NewGuid(), UserId = user.Id, Revision = 2, Date = date,
            InputRevision = 1, ProfileRevision = user.ProfileRevision,
            ResultJson = Json.Write(result), ProfileJson = user.ProfileJson
        };
    }
}
