using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using System.Text.Json;
using Xunit;

namespace Nutrition.Tests;
public sealed class StorageTests : IAsyncLifetime
{
    private readonly string path = Path.Combine(Path.GetTempPath(), $"nutrition-{Guid.NewGuid()}.db");
    private AppDb Open(Guid? user = null) => new(new DbContextOptionsBuilder<AppDb>().UseSqlite($"Data Source={path}").Options) { CurrentUser = user };
    public async Task InitializeAsync() { await using var db = Open(); await db.Database.EnsureCreatedAsync(); }
    public Task DisposeAsync() { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); File.Delete(path); return Task.CompletedTask; }
    private static IConfiguration Config => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Auth:MaxUsers"] = "2" }).Build();
    private async Task<AppUser> User(string name) { await using var db = Open(); return await new AuthService(db,Config).Register(name,"a sufficiently long password",default); }
    [Fact] public async Task Food_portion_migration_is_discoverable()
    {
        await using var db = Open();
        Assert.Contains("20260910120000_FoodPortions", db.Database.GetMigrations());
    }
    [Fact] public async Task Concurrent_registrations_stop_at_two()
    {
        var results = await Task.WhenAll(Enumerable.Range(1,8).Select(async i => { try { await User($"user{i}"); return true; } catch(DomainException) { return false; } }));
        Assert.Equal(2, results.Count(x => x));
        await using var db = Open(); Assert.Equal(2, await db.Users.CountAsync());
    }
    [Fact] public async Task Records_fail_closed_and_writes_reject_foreign_owner()
    {
        var a = await User("alice"); var b = await User("bob");
        await using (var db = Open(a.Id)) { db.Weights.Add(new Weight { Id = Guid.NewGuid(), UserId = a.Id, Date = new(2026,1,1), Kg = 80 }); await db.SaveChangesAsync(); }
        await using (var db = Open(b.Id)) { Assert.Empty(await db.Weights.ToListAsync()); db.Weights.Add(new Weight { Id=Guid.NewGuid(), UserId=a.Id }); await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync()); }
        await using (var db = Open()) Assert.Empty(await db.Weights.ToListAsync());
    }
    [Fact] public async Task Replay_is_idempotent_but_payload_reuse_and_stale_edits_fail()
    {
        var user = await User("alice");
        var op = new Mutation(Guid.NewGuid(),"weight",Guid.NewGuid(),0,JsonSerializer.SerializeToElement(new { date="2026-01-01",kg=80 }));
        async Task<long> Apply(Mutation mutation) { await using var db = Open(user.Id); return await new SyncService(db).Apply(mutation,default); }
        Assert.Equal(await Apply(op), await Apply(op));
        await Assert.ThrowsAsync<DomainException>(() => Apply(op with { Data = JsonSerializer.SerializeToElement(new { date="2026-01-01",kg=81 }) }));
        await Assert.ThrowsAsync<DomainException>(() => Apply(op with { Id=Guid.NewGuid() }));
    }
    [Fact] public async Task Editing_food_keeps_diary_snapshot_unchanged()
    {
        var user=await User("alice"); var foodId=Guid.NewGuid();
        async Task<long> Apply(string kind,Guid id,long rev,object data) { await using var db=Open(user.Id); return await new SyncService(db).Apply(new(Guid.NewGuid(),kind,id,rev,JsonSerializer.SerializeToElement(data)),default); }
        var rev=await Apply("food",foodId,0,new { name="Rice",calories=130,servingGrams=100 });
        await Apply("entry",Guid.NewGuid(),0,new { name="Rice",calories=130,date="2026-01-01",meal="Lunch",quantity=100,unit="g" });
        await Apply("food",foodId,rev,new { name="Rice",calories=150,servingGrams=100 });
        await using var verify=Open(user.Id); Assert.Equal(130,(await verify.Entries.SingleAsync()).Calories);
    }
}
