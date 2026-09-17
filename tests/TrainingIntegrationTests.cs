using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class TrainingIntegrationTests
{
    private static readonly DateOnly Today = new(2026, 9, 14);

    [Fact]
    public void Observed_rate_is_absent_without_three_weigh_ins_spanning_fourteen_days()
    {
        Assert.Null(TrainingContextService.ObservedLoss(
            [new WeightPoint(Today.AddDays(-14), 80), new WeightPoint(Today, 79)], Today));
        Assert.Null(TrainingContextService.ObservedLoss(
            [new WeightPoint(Today.AddDays(-7), 80), new WeightPoint(Today.AddDays(-3), 79), new WeightPoint(Today, 78)], Today));
    }

    [Fact]
    public void Observed_rate_uses_the_established_trailing_window()
    {
        var result = TrainingContextService.ObservedLoss(
            [new WeightPoint(Today.AddDays(-21), 80), new WeightPoint(Today.AddDays(-14), 79.5), new WeightPoint(Today, 78)], Today);

        Assert.NotNull(result);
        Assert.Equal(21, result.Value.WindowDays);
        Assert.True(result.Value.RatePercent > 0);
    }

    [Fact]
    public void Summary_merge_keeps_completed_history_and_replaces_ephemeral_rows_in_range()
    {
        static TrainingSummaryItem Item(string id, string status, DateOnly date, string name)
            => new(id, status, date, null, null, name, [], 0, null, null, null);

        var existing = new[]
        {
            Item("completed-1", "completed", Today.AddDays(-2), "Old session"),
            Item("scheduled-1", "scheduled", Today.AddDays(2), "Moved session"),
            Item("in-progress-1", "in_progress", Today.AddDays(1), "In progress")
        };
        var incoming = new[] { Item("scheduled-2", "scheduled", Today.AddDays(2), "New session") };

        var merged = WorkoutSummaryService.Merge(existing, incoming, Today, Today.AddDays(7));

        Assert.Contains(merged, item => item.Id == "completed-1");
        Assert.DoesNotContain(merged, item => item.Id == "scheduled-1");
        Assert.DoesNotContain(merged, item => item.Id == "in-progress-1");
        Assert.Contains(merged, item => item.Id == "scheduled-2");
    }

    [Fact]
    public void Summary_merge_does_not_rewrite_a_frozen_completed_snapshot()
    {
        static TrainingSummaryItem Item(string id, string status, DateOnly date, string name, int sets)
            => new(id, status, date, null, null, name, [], sets, null, null, null);

        var existing = new[] { Item("session-1", "completed", Today.AddDays(-1), "Original", 4) };
        var incoming = new[] { Item("session-1", "completed", Today.AddDays(-1), "Peer correction", 9) };

        var merged = WorkoutSummaryService.Merge(existing, incoming, Today.AddDays(-7), Today);

        var result = Assert.Single(merged);
        Assert.Equal("Original", result.WorkoutName);
        Assert.Equal(4, result.WorkingSetCount);
    }

    [Fact]
    public async Task IsConnected_reflects_active_workout_grant()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        var service = new WorkoutSummaryService(db, null!, new ConfigurationBuilder().Build());
        Assert.False(await service.IsConnected(default));

        var user = new AppUser { IdentitySubject = "test-subject", DisplayName = "User" };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        db.CurrentUser = user.Id;

        var grant = new IntegrationGrant { UserId = user.Id, Peer = "workout", Status = "active" };
        db.IntegrationGrants.Add(grant);
        await db.SaveChangesAsync();

        Assert.True(await service.IsConnected(default));

        grant.Status = "revoked";
        await db.SaveChangesAsync();

        Assert.False(await service.IsConnected(default));
    }

    [Fact]
    public async Task Last_error_is_reported_as_a_generic_temporary_warning()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = new AppUser { IdentitySubject = "test-subject", DisplayName = "User" };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        db.CurrentUser = user.Id;
        db.WorkoutSummaries.Add(new WorkoutSummaryCache
        {
            UserId = user.Id,
            LastError = "provider token details",
            LastErrorAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var service = new WorkoutSummaryService(db, null!, new ConfigurationBuilder().Build());

        Assert.Equal("Workout training summaries are temporarily unavailable. Try again later.", await service.GetLastError(default));
    }

    [Fact]
    public async Task Purge_ephemeral_clears_a_previous_sync_error_even_without_summary_rows()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = new AppUser { IdentitySubject = "test-subject", DisplayName = "User" };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        db.CurrentUser = user.Id;
        db.WorkoutSummaries.Add(new WorkoutSummaryCache
        {
            UserId = user.Id,
            SummaryJson = "[]",
            LastError = "temporary provider error",
            LastErrorAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var service = new WorkoutSummaryService(db, null!, new ConfigurationBuilder().Build());
        await service.PurgeEphemeral(default);

        Assert.Null(await service.GetLastError(default));
    }
}
