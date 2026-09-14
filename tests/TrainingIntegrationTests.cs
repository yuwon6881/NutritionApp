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
}
