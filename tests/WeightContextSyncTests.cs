using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class WeightContextSyncTests
{
    [Fact]
    public async Task Context_is_validated_scoped_and_preserved_for_older_mutation_payloads()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options;
        await using var db = new AppDb(options);
        await db.Database.EnsureCreatedAsync();
        var alice = await TestUsers.CreateAsync(db, "weight-context-alice");
        var bob = await TestUsers.CreateAsync(db, "weight-context-bob");
        db.CurrentUser = alice.Id;
        var sync = new SyncService(db);
        var id = Guid.NewGuid();
        var date = new DateOnly(2026, 9, 11);
        var create = new Mutation(Guid.NewGuid(), "weight", id, 0,
            JsonSerializer.SerializeToElement(new { date, kg = 82, context = "stress" }, Json.Options));

        var revision = await sync.Apply(create, default);
        Assert.Equal(revision, await sync.Apply(create, default));
        Assert.Equal("stress", (await db.Weights.SingleAsync(weight => weight.Id == id)).Context);

        await sync.Apply(new Mutation(Guid.NewGuid(), "weight", id, revision,
            JsonSerializer.SerializeToElement(new { date, kg = 82.1 }, Json.Options)), default);
        Assert.Equal("stress", (await db.Weights.SingleAsync(weight => weight.Id == id)).Context);

        var current = await db.Weights.SingleAsync(weight => weight.Id == id);
        var invalid = new Mutation(Guid.NewGuid(), "weight", id, current.Revision,
            JsonSerializer.SerializeToElement(new { date, kg = 82.1, context = "diagnosis" }, Json.Options));
        await Assert.ThrowsAsync<DomainException>(() => sync.Apply(invalid, default));

        db.CurrentUser = bob.Id;
        Assert.Empty(await db.Weights.ToListAsync());
    }

    [Fact]
    public async Task Offline_replayed_temporary_context_remains_attached_to_the_weight()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options;
        await using var db = new AppDb(options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "weight-context-replay");
        db.CurrentUser = user.Id;
        var sync = new SyncService(db);
        var id = Guid.NewGuid();
        var mutation = new Mutation(Guid.NewGuid(), "weight", id, 0,
            JsonSerializer.SerializeToElement(new { date = new DateOnly(2026, 9, 10), kg = 81.4, context = "menstrual_cycle" }, Json.Options));

        var first = await sync.Apply(mutation, default);
        var replay = await sync.Apply(mutation, default);

        Assert.Equal(first, replay);
        Assert.Equal("menstrual_cycle", (await db.Weights.SingleAsync(weight => weight.Id == id)).Context);
        Assert.Single(await db.Weights.ToListAsync());
    }
}
