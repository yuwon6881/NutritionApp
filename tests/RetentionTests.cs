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
    [Fact] public async Task Compaction_prunes_finished_nutrition_sync_rows_only_for_entries_it_removed()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["Retention:MealDetailDays"]="7" }).Build();
        var user=await TestUsers.CreateAsync(db, "alice");db.CurrentUser=user.Id;
        var today=new DateOnly(2026,9,7);var old=today.AddDays(-10);var recent=today.AddDays(-1);
        var oldEntry=new DiaryEntry{Id=Guid.NewGuid(),UserId=user.Id,Date=old,Name="Rice",Calories=200};
        var recentEntry=new DiaryEntry{Id=Guid.NewGuid(),UserId=user.Id,Date=recent,Name="Egg",Calories=100};
        db.Entries.AddRange(oldEntry,recentEntry);
        GoogleHealthNutritionSyncWork Work(Guid entry,DateOnly date,string state)=>new(){Id=Guid.NewGuid(),UserId=user.Id,EntryId=entry,DesiredDate=date,ProcessingState=state};
        // A row whose entry was moved to a retained date still maps that entry, whatever its last synced date.
        var moved=Work(Guid.NewGuid(),old,"succeeded");
        db.Entries.Add(new DiaryEntry{Id=moved.EntryId,UserId=user.Id,Date=recent,Name="Moved",Calories=50});
        var kept=new[]{Work(Guid.NewGuid(),old,"failed"),Work(Guid.NewGuid(),old,"unknown"),Work(Guid.NewGuid(),old,"pending"),Work(recentEntry.Id,recent,"succeeded"),moved};
        var pruned=new[]{Work(oldEntry.Id,old,"succeeded"),Work(Guid.NewGuid(),old,"cancelled")};
        db.GoogleHealthNutritionSyncWork.AddRange([..kept,..pruned]);
        await db.SaveChangesAsync();

        await new RetentionService(db,config).CompactUser(user.Id,today,default);

        var remaining=(await db.GoogleHealthNutritionSyncWork.Select(w=>w.Id).ToListAsync()).ToHashSet();
        Assert.True(remaining.SetEquals(kept.Select(w=>w.Id)));
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

    [Fact]
    public async Task Compaction_batches_queries_and_preserves_rules_revisions_and_recent_entries()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Retention:MealDetailDays"] = "7" }).Build();
        var user = await TestUsers.CreateAsync(db, "alice");
        db.CurrentUser = user.Id;

        var today = new DateOnly(2026, 9, 7);
        var old1 = today.AddDays(-10);
        var old2 = today.AddDays(-9);
        var old3 = today.AddDays(-8);
        var recent = today.AddDays(-1);

        // Date 1: 2 entries, one with null Protein
        var entry1 = new DiaryEntry { Id = Guid.NewGuid(), UserId = user.Id, Date = old1, Name = "Rice", Calories = 200, Protein = null, Carbs = 40, Fat = 2 };
        var entry2 = new DiaryEntry { Id = Guid.NewGuid(), UserId = user.Id, Date = old1, Name = "Egg", Calories = 100, Protein = 6, Carbs = 1, Fat = 7 };

        // Date 2: 2 entries, one Deleted
        var entry3 = new DiaryEntry { Id = Guid.NewGuid(), UserId = user.Id, Date = old2, Name = "Chicken", Calories = 250, Protein = 30, Carbs = 0, Fat = 5 };
        var entry4 = new DiaryEntry { Id = Guid.NewGuid(), UserId = user.Id, Date = old2, Name = "Deleted snack", Calories = 50, Protein = 2, Carbs = 5, Fat = 1, Deleted = true };

        // Date 3: old not_logged day with no entries
        var day3 = new DayStatus { Id = Guid.NewGuid(), UserId = user.Id, Date = old3, Status = "not_logged" };

        // Recent entry
        var recentEntry = new DiaryEntry { Id = Guid.NewGuid(), UserId = user.Id, Date = recent, Name = "Apple", Calories = 80, Protein = 0, Carbs = 20, Fat = 0 };

        db.Entries.AddRange(entry1, entry2, entry3, entry4, recentEntry);
        db.Days.Add(day3);
        await db.SaveChangesAsync();

        var retention = new RetentionService(db, config);
        var removed = await retention.CompactUser(user.Id, today, default);

        Assert.Equal(4, removed);

        var days = (await db.Days.ToListAsync()).ToDictionary(d => d.Date);
        Assert.Equal(3, days.Count);

        var d1 = days[old1];
        Assert.True(d1.Archived);
        Assert.Equal(300, d1.Calories);
        Assert.Null(d1.Protein);
        Assert.Equal(41, d1.Carbs);
        Assert.Equal(9, d1.Fat);
        Assert.Equal(2, d1.EntryCount);
        Assert.Equal("complete", d1.Status);

        var d2 = days[old2];
        Assert.True(d2.Archived);
        Assert.Equal(250, d2.Calories);
        Assert.Equal(30, d2.Protein);
        Assert.Equal(0, d2.Carbs);
        Assert.Equal(5, d2.Fat);
        Assert.Equal(1, d2.EntryCount);
        Assert.Equal("complete", d2.Status);

        var d3 = days[old3];
        Assert.True(d3.Archived);
        Assert.Equal(0, d3.Calories);
        Assert.Equal(0, d3.Protein);
        Assert.Equal(0, d3.Carbs);
        Assert.Equal(0, d3.Fat);
        Assert.Equal(0, d3.EntryCount);
        Assert.Equal("not_logged", d3.Status);

        Assert.Equal(3, new[] { d1.Revision, d2.Revision, d3.Revision }.Distinct().Count());

        var reloadedUser = await db.Users.SingleAsync(u => u.Id == user.Id);
        Assert.Equal(reloadedUser.Revision, reloadedUser.DiaryRevision);

        var remainingEntries = await db.Entries.ToListAsync();
        Assert.Single(remainingEntries);
        Assert.Equal(recentEntry.Id, remainingEntries[0].Id);
    }
}
