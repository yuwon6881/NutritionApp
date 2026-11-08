using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;
namespace Nutrition.Tests;
public class RetentionTests
{
    private static async Task<(Microsoft.Data.Sqlite.SqliteConnection connection,AppDb db)> Open()
    {
        var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        return (connection,db);
    }
    private static StorageService Storage(AppDb db,IConfiguration config)
        => new(db,new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions()),new TemporaryImageStore(new HttpClient(),config),config);

    [Fact] public async Task Meal_detail_is_never_compacted_and_old_entries_stay_editable()
    {
        var (connection,db)=await Open();await using var _c=connection;await using var _d=db;
        var user=await TestUsers.CreateAsync(db,"alice");db.CurrentUser=user.Id;
        var today=ProfileClock.Today(user.ProfileJson);var old=today.AddDays(-200);var id=Guid.NewGuid();
        var sync=new SyncService(db);
        var revision=await sync.Apply(new(Guid.NewGuid(),"entry",id,0,System.Text.Json.JsonSerializer.SerializeToElement(new{date=old,time="08:00",name="Rice",calories=200})),default);
        await sync.Apply(new(Guid.NewGuid(),"entry",id,revision,System.Text.Json.JsonSerializer.SerializeToElement(new{date=old,time="08:00",name="Rice",calories=250})),default);
        await Storage(db,new ConfigurationBuilder().Build()).Cleanup(default);
        var entry=await db.Entries.SingleAsync();Assert.Equal(250,entry.Calories);Assert.Equal(old,entry.Date);
        Assert.Empty(await db.Days.ToListAsync());
    }
    [Fact] public async Task Cleanup_purges_only_deleted_entries_past_the_tombstone_window()
    {
        var (connection,db)=await Open();await using var _c=connection;await using var _d=db;
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Retention:TombstoneDays"]="90"}).Build();
        var user=await TestUsers.CreateAsync(db,"alice");db.CurrentUser=user.Id;
        var now=DateTime.UtcNow;var date=DateOnly.FromDateTime(now).AddDays(-400);
        DiaryEntry Entry(string name,bool deleted,DateTime? deletedAt)=>new(){Id=Guid.NewGuid(),UserId=user.Id,Date=date,Name=name,Calories=100,Deleted=deleted,DeletedAt=deletedAt};
        db.Entries.AddRange(Entry("live",false,null),Entry("long gone",true,now.AddDays(-100)),Entry("just deleted",true,now.AddDays(-5)));
        await db.SaveChangesAsync();
        await Storage(db,config).Cleanup(default);
        var names=(await db.Entries.IgnoreQueryFilters().Select(e=>e.Name).ToListAsync()).Order().ToArray();
        Assert.Equal(["just deleted","live"],names);
    }
    [Fact] public async Task Cleanup_prunes_finished_nutrition_sync_rows_only_for_entries_that_no_longer_exist()
    {
        var (connection,db)=await Open();await using var _c=connection;await using var _d=db;
        var user=await TestUsers.CreateAsync(db,"alice");db.CurrentUser=user.Id;
        var date=DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-200);
        var live=new DiaryEntry{Id=Guid.NewGuid(),UserId=user.Id,Date=date,Name="Rice",Calories=200};
        db.Entries.Add(live);
        GoogleHealthNutritionSyncWork Work(Guid entry,string state)=>new(){Id=Guid.NewGuid(),UserId=user.Id,EntryId=entry,DesiredDate=date,ProcessingState=state};
        var kept=new[]{Work(live.Id,"succeeded"),Work(Guid.NewGuid(),"failed"),Work(Guid.NewGuid(),"unknown"),Work(Guid.NewGuid(),"pending")};
        var pruned=new[]{Work(Guid.NewGuid(),"succeeded"),Work(Guid.NewGuid(),"cancelled")};
        db.GoogleHealthNutritionSyncWork.AddRange([..kept,..pruned]);await db.SaveChangesAsync();
        await Storage(db,new ConfigurationBuilder().Build()).Cleanup(default);
        var remaining=(await db.GoogleHealthNutritionSyncWork.Select(w=>w.Id).ToListAsync()).ToHashSet();
        Assert.True(remaining.SetEquals(kept.Select(w=>w.Id)));
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
            ["Retention:ReceiptDays"] = "30"
        }).Build();

        await Storage(db, config).Cleanup(default);

        var remaining = await db.Receipts.IgnoreQueryFilters().Where(r => r.UserId == user.Id).ToListAsync();
        Assert.Single(remaining);
        Assert.True(remaining[0].Created > now.AddDays(-10));
    }

    [Fact]
    public async Task Food_tombstones_are_hard_deleted_by_cleanup()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        var user = await TestUsers.CreateAsync(db, "alice");
        db.CurrentUser = user.Id;
        db.Foods.AddRange(
            new Food { Id = Guid.NewGuid(), UserId = user.Id, Name = "Deleted food", Deleted = true, Revision = 1 },
            new Food { Id = Guid.NewGuid(), UserId = user.Id, Name = "Active food", Deleted = false, Revision = 2 }
        );
        await db.SaveChangesAsync();

        var cache = new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions());
        var images = new TemporaryImageStore(new HttpClient(), new ConfigurationBuilder().Build());
        var storage = new StorageService(db, cache, images);

        await storage.Cleanup(default);

        var remaining = await db.Foods.IgnoreQueryFilters().ToListAsync();
        Assert.Single(remaining);
        Assert.Equal("Active food", remaining[0].Name);
    }

    [Fact]
    public async Task Photo_tombstones_older_than_retention_window_are_hard_deleted()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        var user = await TestUsers.CreateAsync(db, "alice");
        db.CurrentUser = user.Id;
        var now = DateTime.UtcNow;
        db.Photos.AddRange(
            new PhysiquePhoto { Id = Guid.NewGuid(), UserId = user.Id, SetId = Guid.NewGuid(), Date = DateOnly.FromDateTime(now.AddDays(-120)), Deleted = true, Status = "deleted", Created = now.AddDays(-120), Revision = 1 },
            new PhysiquePhoto { Id = Guid.NewGuid(), UserId = user.Id, SetId = Guid.NewGuid(), Date = DateOnly.FromDateTime(now.AddDays(-5)), Deleted = true, Status = "deleted", Created = now.AddDays(-5), Revision = 2 },
            new PhysiquePhoto { Id = Guid.NewGuid(), UserId = user.Id, SetId = Guid.NewGuid(), Date = DateOnly.FromDateTime(now), Deleted = false, Status = "complete", Created = now, Revision = 3 }
        );
        await db.SaveChangesAsync();

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Retention:TombstoneDays"] = "90"
        }).Build();
        var cache = new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions());
        var images = new TemporaryImageStore(new HttpClient(), config);
        var storage = new StorageService(db, cache, images, config);

        await storage.Cleanup(default);

        var remaining = await db.Photos.IgnoreQueryFilters().ToListAsync();
        // Old tombstone (120 days) deleted, recent tombstone (5 days) and active photo preserved
        Assert.Equal(2, remaining.Count);
        Assert.DoesNotContain(remaining, p => p.Created < now.AddDays(-100));
    }

    [Fact]
    public async Task BodyRecord_tombstones_older_than_retention_window_are_hard_deleted()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        var user = await TestUsers.CreateAsync(db, "alice");
        db.CurrentUser = user.Id;
        var now = DateTime.UtcNow;
        db.BodyRecords.AddRange(
            new BodyRecord { Id = Guid.NewGuid(), UserId = user.Id, Date = DateOnly.FromDateTime(now.AddDays(-120)), CreationOrder = 1, Created = now.AddDays(-120), Updated = now.AddDays(-120), Deleted = true, Revision = 1 },
            new BodyRecord { Id = Guid.NewGuid(), UserId = user.Id, Date = DateOnly.FromDateTime(now.AddDays(-5)), CreationOrder = 2, Created = now.AddDays(-5), Updated = now.AddDays(-5), Deleted = true, Revision = 2 },
            new BodyRecord { Id = Guid.NewGuid(), UserId = user.Id, Date = DateOnly.FromDateTime(now), CreationOrder = 3, Created = now, Updated = now, Deleted = false, Revision = 3 }
        );
        await db.SaveChangesAsync();

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Retention:TombstoneDays"] = "90"
        }).Build();
        var cache = new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions());
        var images = new TemporaryImageStore(new HttpClient(), config);
        var storage = new StorageService(db, cache, images, config);

        await storage.Cleanup(default);

        var remaining = await db.BodyRecords.IgnoreQueryFilters().ToListAsync();
        // Old tombstone (120 days) deleted, recent tombstone (5 days) and active record preserved
        Assert.Equal(2, remaining.Count);
        Assert.DoesNotContain(remaining, b => b.Created < now.AddDays(-100));
    }

    [Fact]
    public async Task Storage_cleanup_prunes_orphaned_succeeded_and_cancelled_body_fat_sync_work()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        var user = await TestUsers.CreateAsync(db, "alice");
        db.CurrentUser = user.Id;
        var now = DateTime.UtcNow;

        var liveRecord = new BodyRecord { Id = Guid.NewGuid(), UserId = user.Id, Date = DateOnly.FromDateTime(now), CreationOrder = 1, Created = now, Updated = now, Deleted = false, Revision = 1 };
        var purgedRecord = new BodyRecord { Id = Guid.NewGuid(), UserId = user.Id, Date = DateOnly.FromDateTime(now.AddDays(-120)), CreationOrder = 2, Created = now.AddDays(-120), Updated = now.AddDays(-120), Deleted = true, DeletedAt = now.AddDays(-120), Revision = 2 };
        db.BodyRecords.AddRange(liveRecord, purgedRecord);

        GoogleHealthBodyFatSyncWork Work(Guid recordId, string state) => new()
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            BodyRecordId = recordId,
            ProcessingState = state
        };

        var purgedSucceeded = Work(purgedRecord.Id, "succeeded");
        var cancelledOrphan = Work(Guid.NewGuid(), "cancelled");
        var pendingOrphan = Work(Guid.NewGuid(), "pending");
        var failedOrphan = Work(Guid.NewGuid(), "failed");
        var unknownOrphan = Work(Guid.NewGuid(), "unknown");
        var liveSucceeded = Work(liveRecord.Id, "succeeded");

        db.GoogleHealthBodyFatSyncWork.AddRange(purgedSucceeded, cancelledOrphan, pendingOrphan, failedOrphan, unknownOrphan, liveSucceeded);
        await db.SaveChangesAsync();

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Retention:TombstoneDays"] = "90"
        }).Build();
        var cache = new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions());
        var images = new TemporaryImageStore(new HttpClient(), config);
        var storage = new StorageService(db, cache, images, config);

        await storage.Cleanup(default);

        var remaining = await db.GoogleHealthBodyFatSyncWork.IgnoreQueryFilters().ToListAsync();
        Assert.DoesNotContain(remaining, w => w.Id == purgedSucceeded.Id);
        Assert.DoesNotContain(remaining, w => w.Id == cancelledOrphan.Id);
        Assert.Contains(remaining, w => w.Id == pendingOrphan.Id);
        Assert.Contains(remaining, w => w.Id == failedOrphan.Id);
        Assert.Contains(remaining, w => w.Id == unknownOrphan.Id);
        Assert.Contains(remaining, w => w.Id == liveSucceeded.Id);
    }


    [Theory]
    [InlineData("Not/AZone")]
    [InlineData("")]
    [InlineData(null)]
    public void Unknown_time_zone_falls_back_to_the_default_instead_of_throwing(string? id)
        => Assert.Equal("Asia/Kuala_Lumpur", ProfileClock.ResolveZone(id).Id);
}
