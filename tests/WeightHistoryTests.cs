using System.Collections;
using System.Runtime.CompilerServices;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// The bounded warm-up must give the same answers as reading every weigh-in ever recorded.
public sealed class WeightHistoryTests
{
    private static readonly DateOnly Today = new(2026, 9, 30);

    public static TheoryData<string> Histories => new() { "dense", "gappy", "sparse-recent", "stale", "marked-recent", "outliers" };

    [Theory]
    [MemberData(nameof(Histories))]
    public async Task Every_trend_consumer_matches_the_full_history_result(string shape)
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "alice");
        db.CurrentUser = user.Id;
        var all = Fixture(shape);
        db.Weights.AddRange(all.Select(w => new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = w.Date, Kg = w.Kg, Context = w.Context }));
        await db.SaveChangesAsync();

        foreach (var today in new[] { Today, Today.AddDays(-3), Today.AddDays(-200) })
        {
            var dated = all.Where(w => w.Date <= today).ToArray();
            foreach (var target in new[] { 70d, 78d, 84d })
            foreach (var metric in new[] { "scale", "trend" })
            {
                var profile = new Profile { Goal = "lose", PhaseMode = "weight", TargetWeightKg = target, WeightKg = 90, GoalRatePercent = .5 };
                Same(TrainingContextService.WeightContext(profile, dated, today, null, metric).Result,
                    await WeightHistory.Compute(db, today.AddDays(-28), today, w => TrainingContextService.WeightContext(profile, w, today, null, metric), default));
                Same(CoachingService.GoalWeights(profile, all, today, null, metric).Result,
                    await WeightHistory.Compute(db, today.AddDays(-28), DateOnly.MaxValue, w => CoachingService.GoalWeights(profile, w, today, null, metric), default));
            }
            foreach (var start in new[] { today.AddDays(-6), today.AddDays(-89), today.AddDays(-365), all[0].Date })
                Same(ProgressSummaryService.WeightPoints(dated, start),
                    await WeightHistory.Compute(db, start, today, w => (ProgressSummaryService.WeightPoints(w, start), (DateOnly?)start), default));
            var peerStart = today.AddDays(-13);
            Same(NutritionPeerSummaryService.Weights(dated, peerStart, today),
                await WeightHistory.Compute(db, today.AddDays(-28), today, w => (NutritionPeerSummaryService.Weights(w, peerStart, today), (DateOnly?)today.AddDays(-28)), default));
            Same(BodyRecordService.CaptureWeights(dated).Result,
                await WeightHistory.Compute(db, today.AddDays(-28), today, BodyRecordService.CaptureWeights, default));
        }
    }

    [Fact]
    public async Task A_dense_history_reads_only_the_warm_up()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "alice");
        db.CurrentUser = user.Id;
        var all = Fixture("dense");
        db.Weights.AddRange(all.Select(w => new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = w.Date, Kg = w.Kg, Context = w.Context }));
        await db.SaveChangesAsync();
        var reads = new List<int>();
        await WeightHistory.Compute(db, Today.AddDays(-28), Today, w => { reads.Add(w.Count); return (0, (DateOnly?)Today.AddDays(-28)); }, default);
        Assert.Single(reads);
        Assert.InRange(reads[0], 1, 28 + WeightHistory.TrendWarmupDays + 8);
        Assert.True(all.Length > 3000);
    }

    private static WeightPoint[] Fixture(string shape)
    {
        var random = new Random(shape.GetHashCode(StringComparison.Ordinal) & 0x7fff);
        var points = new List<WeightPoint>();
        var first = Today.AddDays(-3650);
        for (var date = first; date <= Today; date = date.AddDays(1))
        {
            var age = Today.DayNumber - date.DayNumber;
            var include = shape switch
            {
                "gappy" => random.NextDouble() < (age % 400 < 120 ? .05 : .7),
                "sparse-recent" => age > 500 || age is 2 or 40,
                "stale" => age > 600,
                _ => random.NextDouble() < .85
            };
            if (!include) continue;
            var kg = 95 - age * -0.004 - 15 * Math.Sin(age / 300d) + (random.NextDouble() - .5) * 1.4;
            if (shape == "outliers" && random.NextDouble() < .08) kg += random.NextDouble() < .5 ? 4 : -4;
            string? context = random.NextDouble() < (shape == "marked-recent" && age < 30 ? .5 : .06)
                ? (random.NextDouble() < .7 ? "high_sodium" : "genuine_change") : null;
            if (context == "high_sodium") kg += 1.2;
            points.Add(new(date, Math.Round(kg, 1), context));
        }
        return points.ToArray();
    }

    private static void Same(object? expected, object? actual, string path = "result")
    {
        if (expected is null || actual is null) { Assert.True(expected is null && actual is null, $"{path}: {expected} vs {actual}"); return; }
        switch (expected)
        {
            case double e:
                Assert.True(Math.Abs(e - (double)actual) <= 1e-9, $"{path}: {e} vs {actual}");
                return;
            case string or bool or int or long or DateOnly or DateTime or Enum:
                Assert.Equal(expected, actual);
                return;
            case ITuple tuple:
                for (var i = 0; i < tuple.Length; i++) Same(tuple[i], ((ITuple)actual)[i], $"{path}.{i}");
                return;
            case IEnumerable sequence:
                var left = sequence.Cast<object?>().ToArray();
                var right = ((IEnumerable)actual).Cast<object?>().ToArray();
                Assert.True(left.Length == right.Length, $"{path}: {left.Length} vs {right.Length} items");
                for (var i = 0; i < left.Length; i++) Same(left[i], right[i], $"{path}[{i}]");
                return;
        }
        foreach (var property in expected.GetType().GetProperties().Where(p => p.GetIndexParameters().Length == 0 && p.Name != "EqualityContract"))
            Same(property.GetValue(expected), property.GetValue(actual), $"{path}.{property.Name}");
    }
}
