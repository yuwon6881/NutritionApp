using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class TrainingContextCacheTests
{
    [Fact]
    public void Observed_loss_ignores_temporary_weight_context_and_keeps_sustained_changes()
    {
        var today = new DateOnly(2026, 10, 4);
        var weights = Enumerable.Range(0, 22).Select(i => new WeightPoint(today.AddDays(i - 21),
            i == 21 ? 72 : 80, i == 21 ? "dehydration" : null)).ToArray();
        var loss = TrainingContextService.ObservedLoss(weights, today);
        Assert.NotNull(loss);
        Assert.Equal(0, loss.Value.RatePercent);
        var sustained = weights.Select(w => w with { Kg = 80 - .04 * (w.Date.DayNumber - weights[0].Date.DayNumber), Context = null }).ToArray();
        Assert.True(TrainingContextService.ObservedLoss(sustained, today)!.Value.RatePercent > 0);
    }

    [Fact]
    public async Task Published_scale_weight_skips_a_weigh_in_marked_as_temporary()
    {
        // Workout prefers a same-day scale weight for bodyweight loads; a bloated morning the user
        // marked as temporary must not become the reference for a pull-up or dip.
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = new AppUser { IdentitySubject = "alice", DisplayName = "Alice", Revision = 1,
            ProfileJson = Json.Write(new Profile { Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4, Goal = "maintain", TimeZone = "UTC" }) };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        db.CurrentUser = user.Id;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        db.Weights.AddRange(
            new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = today.AddDays(-2), Kg = 80 },
            new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = today.AddDays(-1), Kg = 80.1 },
            new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = today, Kg = 82.4, Context = "bloating" });
        await db.SaveChangesAsync();

        var context = await new TrainingContextService(db).Get("alice", default);

        Assert.Equal(80.1, context.ScaleWeightKg);
        Assert.Equal(today.AddDays(-1), context.ScaleWeightDate);
    }

    [Fact]
    public async Task Reuses_identical_calculations_and_invalidates_a_backdated_weight_edit()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = new AppUser { IdentitySubject = "alice", DisplayName = "Alice", Revision = 1,
            ProfileJson = Json.Write(new Profile { Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4, Goal = "maintain", TimeZone = "UTC" }) };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        db.CurrentUser = user.Id;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var old = new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = today.AddDays(-20), Kg = 80 };
        db.Weights.AddRange(old, new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = today.AddDays(-14), Kg = 79.5 }, new Weight { Id = Guid.NewGuid(), UserId = user.Id, Date = today, Kg = 79 });
        await db.SaveChangesAsync();
        using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 256 });
        var service = new TrainingContextService(db, cache);
        var first = await service.Get("alice", default);
        Assert.Same(first, await service.Get("alice", default));
        old.Kg = 85;
        user.Revision++;
        await db.SaveChangesAsync();
        var changed = await service.Get("alice", default);
        Assert.NotSame(first, changed);
        Assert.Equal(await new TrainingContextService(db).Get("alice", default), changed);
        Assert.NotEqual(first.TrendWeightKg, changed.TrendWeightKg);
    }
}
