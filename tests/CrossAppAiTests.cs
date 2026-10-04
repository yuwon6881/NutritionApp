using Fitness.Ai.Contracts;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class CrossAppAiTests
{
    [Fact]
    public void Canonical_workout_fixture_uses_completion_dates_and_produces_the_eighteen_percent_example()
    {
        using var fixture = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures/fitness-ai.examples.json")));
        var root = fixture.RootElement;
        var rows = System.Text.Json.JsonSerializer.Deserialize<TrainingSummaryItem[]>(root.GetProperty("workouts"), Json.Options)!;
        var today = DateOnly.Parse(root.GetProperty("today").GetString()!);
        var result = new WorkoutPeerResult("connected", "available", "live", today.AddDays(-14), today,
            root.GetProperty("timeZone").GetString()!, today.AddDays(-14), today, DateTime.UtcNow, true, null, rows);
        Assert.Equal(root.GetProperty("expectedExternalVolumeChangePercent").GetDouble(), WorkoutAiComparisons.Compare(result, today)!.ExternalVolumeChangePercent);
        Assert.Equal(9, WorkoutAiComparisons.Compare(result, today)!.Current.RecordedSetRpe);
    }

    [Fact]
    public async Task Daily_read_keeps_unknowns_fasting_archives_and_date_effective_targets()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "cross-ai");
        db.CurrentUser = user.Id;
        var today = new DateOnly(2026, 10, 4);
        db.Plans.AddRange(
            new AcceptedPlan { Id = Guid.NewGuid(), UserId = user.Id, Date = today.AddDays(-7), ProfileJson = "{}", ResultJson = Json.Write(new CoachResult(true, false, 2000, 2400, 150, 60, 200, "old")) },
            new AcceptedPlan { Id = Guid.NewGuid(), UserId = user.Id, Date = today, ProfileJson = "{}", ResultJson = Json.Write(new CoachResult(true, false, 2200, 2500, 160, 65, 210, "new")) });
        db.Days.AddRange(new DayStatus { Id = Guid.NewGuid(), UserId = user.Id, Date = today.AddDays(-3), Status = "fasting" },
            new DayStatus { Id = Guid.NewGuid(), UserId = user.Id, Date = today.AddDays(-2), Status = "not_logged" },
            new DayStatus { Id = Guid.NewGuid(), UserId = user.Id, Date = today.AddDays(-1), Archived = true, EntryCount = 2, Calories = 1800, Protein = null });
        db.Entries.Add(new DiaryEntry { Id = Guid.NewGuid(), UserId = user.Id, Date = today, Calories = 500, Protein = 25 });
        await db.SaveChangesAsync();
        var rows = await new NutritionDailySummaryService(db).Get(today.AddDays(-4), today, today, default);
        Assert.Null(rows.Single(d => d.Date == today.AddDays(-4)).Calories);
        Assert.Equal(0, rows.Single(d => d.Status == "fasting").Calories);
        Assert.Null(rows.Single(d => d.Status == "not_logged").Calories);
        var historical = rows.Single(d => d.Archived);
        Assert.Null(historical.Protein);
        Assert.Equal(2000, historical.Targets!.Calories);
        Assert.Equal(2200, rows.Single(d => d.Date == today).Targets!.Calories);
        var aggregate = NutritionPeerSummaryService.Aggregate(rows, today.AddDays(-4), today);
        Assert.Equal(2, aggregate.CompleteDays);
        Assert.Equal(900, aggregate.AverageCalories);
        Assert.Equal(2, aggregate.UnknownIntakeDays);
        Assert.Equal(1, aggregate.UnknownCompletedNutrientDays!["protein"]);
        Assert.Equal(1, aggregate.ProteinKnownDays);
        Assert.Equal(1100, aggregate.AverageBelowTargetCalories);
        Assert.Equal(1500, aggregate.AverageEstimatedDeficitCalories);
    }

    [Theory]
    [InlineData(false, false, null)]
    [InlineData(true, false, null)]
    [InlineData(true, true, 18.0)]
    public void Comparisons_require_coverage_and_matching_load_models(bool covered, bool sameMix, double? expected)
    {
        var today = new DateOnly(2026, 10, 4);
        TrainingSummaryItem Item(string id, DateOnly date, double volume, string mix, string status = "completed") =>
            new(id, status, date.AddDays(-1), null, null, id, [], 5, volume, null, 8, date, 5, 0, 0, 5, true, [mix], true, false);
        var rows = new[] { Item("old", today.AddDays(-10), 1000, "squat:external"),
            Item("new", today.AddDays(-3), 1180, sameMix ? "squat:external" : "squat:full_bodyweight"),
            Item("planned", today.AddDays(-2), 10000, "squat:external", "upcoming"),
            Item("active", today.AddDays(-1), 10000, "squat:external", "in_progress") };
        var result = new WorkoutPeerResult("connected", "available", "live", today.AddDays(-14), today, "UTC",
            today.AddDays(-14), today, DateTime.UtcNow, covered, null, rows);
        var comparison = WorkoutAiComparisons.Compare(result, today)!;
        Assert.Equal(expected, comparison.ExternalVolumeChangePercent);
        Assert.Equal(1, comparison.Current.CompletedSessions);
        Assert.Equal(5, comparison.Current.WorkingSets);
        Assert.Equal(8, comparison.Current.RecordedSetRpe);
    }

    [Fact]
    public void Zero_and_missing_volume_never_produce_a_percentage()
    {
        var today = new DateOnly(2026, 10, 4);
        var old = new TrainingSummaryItem("old", "completed", today.AddDays(-10), null, null, "Old", [], 0, 0, null, null,
            CompletionDate: today.AddDays(-10), ExerciseMix: ["squat"]);
        var recent = old with { Id = "new", LocalDate = today.AddDays(-1), CompletionDate = today.AddDays(-1), ExternalVolumeKg = null };
        var result = new WorkoutPeerResult("connected", "available", "live", today.AddDays(-14), today, "UTC", null, null, null, true, null, [old, recent]);
        Assert.Null(WorkoutAiComparisons.Compare(result, today)!.ExternalVolumeChangePercent);
        Assert.Null(WorkoutAiComparisons.Window([recent], today.AddDays(-7), today).ExternalVolumeKg);
        var partial = recent with { ExternalVolumeKg = 1000, ExternalVolumeComplete = false };
        Assert.Null(WorkoutAiComparisons.Window([partial], today.AddDays(-7), today).ExternalVolumeKg);
        Assert.Equal(0, WorkoutAiComparisons.Window([partial], today.AddDays(-7), today).ExternalVolumeKnownSessions);
        var knownEffort = recent with { EffortRecordedSets = 5, AverageRpe = 8 };
        var missingEffort = recent with { EffortRecordedSets = 5, AverageRpe = null };
        Assert.Null(WorkoutAiComparisons.Window([knownEffort, missingEffort], today.AddDays(-7), today).RecordedSetRpe);
    }
}
