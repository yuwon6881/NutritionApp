using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;
namespace Nutrition.Tests;
public class RetentionTests
{
    [Fact] public async Task Rollup_preserves_totals_unknowns_weights_and_coaching_then_rejects_old_detail_writes()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Retention:MealDetailDays"]="7" }).Build();
        var user=await TestUsers.CreateAsync(db, "alice");db.CurrentUser=user.Id;
        var today=new DateOnly(2026,9,7);var old=today.AddDays(-10);
        db.Entries.AddRange(new DiaryEntry { Id=Guid.NewGuid(),UserId=user.Id,Date=old,Name="Rice",Calories=200,Protein=null,Carbs=40,Fat=2 },new DiaryEntry { Id=Guid.NewGuid(),UserId=user.Id,Date=old,Name="Egg",Calories=100,Protein=6,Carbs=1,Fat=7 });
        db.Days.Add(new DayStatus { Id=Guid.NewGuid(),UserId=user.Id,Date=old,Status="complete" });
        db.Weights.Add(new Weight { Id=Guid.NewGuid(),UserId=user.Id,Date=old,Kg=80 });await db.SaveChangesAsync();
        var retention=new RetentionService(db,config);
        Assert.Equal(2,await retention.CompactUser(user.Id,today,default));
        var summary=await db.Days.SingleAsync();Assert.True(summary.Archived);Assert.Equal(300,summary.Calories);Assert.Null(summary.Protein);Assert.Equal(41,summary.Carbs);Assert.Equal(2,summary.EntryCount);Assert.Equal("complete",summary.Status);
        Assert.Empty(await db.Entries.ToListAsync());Assert.Single(await db.Weights.ToListAsync());
        Assert.Equal(0,await retention.CompactUser(user.Id,today,default));Assert.Equal(300,(await db.Days.SingleAsync()).Calories);
        Assert.Throws<DomainException>(()=>retention.RequireEditable(DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-100),""));
    }
    [Fact] public void Cutoff_keeps_seven_recent_calendar_days() => Assert.Equal(new DateOnly(2026,9,1),RetentionService.Cutoff(new DateOnly(2026,9,7),7));
    [Fact] public async Task Twenty_eight_day_coaching_result_is_identical_after_detail_compaction()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Retention:MealDetailDays"]="7" }).Build();var user=await TestUsers.CreateAsync(db, "alice");db.CurrentUser=user.Id;
        var today=new DateOnly(2026,9,7);var weights=new List<WeightPoint>();
        for(var i=1;i<=28;i++){var date=today.AddDays(-i);weights.Add(new(date,80));db.Entries.Add(new DiaryEntry{Id=Guid.NewGuid(),UserId=user.Id,Date=date,Name="Daily total",Calories=2500});db.Days.Add(new DayStatus{Id=Guid.NewGuid(),UserId=user.Id,Date=date,Status="complete"});}
        await db.SaveChangesAsync();
        var profile=new Profile{Age=30,HeightCm=175,WeightKg=80,Sex="male",Maintenance=2500};
        var before=Coach.Calculate(profile,weights.Select(w=>new NutritionDay(w.Date,"complete",2500)).ToList(),weights,new(2500,2500),today);
        await new RetentionService(db,config).CompactUser(user.Id,today,default);
        var entries=await db.Entries.ToListAsync();var statuses=await db.Days.ToListAsync();
        var after=Coach.Calculate(profile,statuses.Select(d=>new NutritionDay(d.Date,d.Status,d.Archived?d.Calories:entries.Where(e=>e.Date==d.Date).Sum(e=>e.Calories))).ToList(),weights,new(2500,2500),today);
        Assert.Equal(before,after);Assert.True(after.Adaptive);
    }

    [Fact]
    public async Task GoogleHealthOAuthStates_expired_are_deleted_by_storage_cleanup()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        var user = await TestUsers.CreateAsync(db, "alice");
        db.CurrentUser = user.Id;
        var now = DateTime.UtcNow;
        db.GoogleHealthOAuthStates.AddRange(
            new GoogleHealthOAuthState { State = "expired_state", UserId = user.Id, ExpiresAt = now.AddMinutes(-5) },
            new GoogleHealthOAuthState { State = "valid_state", UserId = user.Id, ExpiresAt = now.AddMinutes(5) }
        );
        await db.SaveChangesAsync();

        var cache = new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions());
        var images = new TemporaryImageStore(new HttpClient(), new ConfigurationBuilder().Build());
        var storage = new StorageService(db, cache, images);

        await storage.Cleanup(default);

        var remaining = await db.GoogleHealthOAuthStates.IgnoreQueryFilters().ToListAsync();
        Assert.Single(remaining);
        Assert.Equal("valid_state", remaining[0].State);
    }

    [Fact]
    public async Task AiUsage_is_pruned_according_to_configured_retention_window()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        var user = await TestUsers.CreateAsync(db, "alice");
        db.CurrentUser = user.Id;
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        db.Usage.AddRange(
            new AiUsage { UserId = user.Id, Date = today.AddDays(-45), Requests = 5 },
            new AiUsage { UserId = user.Id, Date = today.AddDays(-10), Requests = 3 }
        );
        await db.SaveChangesAsync();

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Retention:AiUsageMonths"] = "1"
        }).Build();
        var cache = new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions());
        var images = new TemporaryImageStore(new HttpClient(), config);
        var storage = new StorageService(db, cache, images, config);

        await storage.Cleanup(default);

        var remaining = await db.Usage.IgnoreQueryFilters().ToListAsync();
        Assert.Single(remaining);
        Assert.Equal(today.AddDays(-10), remaining[0].Date);
    }

    [Fact]
    public async Task Receipts_are_pruned_according_to_configured_retention_window()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        var user = await TestUsers.CreateAsync(db, "alice");
        db.CurrentUser = user.Id;
        var now = DateTime.UtcNow;
        db.Receipts.AddRange(
            new MutationReceipt { UserId = user.Id, Id = Guid.NewGuid(), Created = now.AddDays(-40) },
            new MutationReceipt { UserId = user.Id, Id = Guid.NewGuid(), Created = now.AddDays(-5) }
        );
        await db.SaveChangesAsync();

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Retention:MealDetailDays"] = "90",
            ["Retention:ReceiptDays"] = "30"
        }).Build();
        var retention = new RetentionService(db, config);

        await retention.CompactUser(user.Id, DateOnly.FromDateTime(now), default);

        var remaining = await db.Receipts.Where(r => r.UserId == user.Id).ToListAsync();
        Assert.Single(remaining);
        Assert.True(remaining[0].Created > now.AddDays(-10));
    }
}
