using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using System.Text.Json;
using Xunit;
namespace Nutrition.Tests;

/// <summary>
/// A day decision is one row per date. A device that queued a decision without seeing the saved
/// one (another device decided first, or its cached diary was stale) must not be left holding an
/// unresolvable conflict, and it must never replace the saved decision.
/// </summary>
public class DayDecisionSyncTests
{
    private static async Task<(AppDb db,Microsoft.Data.Sqlite.SqliteConnection connection,AppUser user)> Open()
    {
        var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db,"alice");db.CurrentUser=user.Id;
        return (db,connection,user);
    }

    private static Mutation Day(Guid recordId,long expected,DateOnly date,string status)
        =>new(Guid.NewGuid(),"day",recordId,expected,JsonSerializer.SerializeToElement(new{date,status}));

    [Fact] public async Task A_second_device_deciding_the_same_date_is_accepted_without_a_duplicate_row()
    {
        var (db,connection,_)=await Open();await using var _db=db;await using var _connection=connection;
        var sync=new SyncService(db);var date=RetentionService.Today("").AddDays(-1);
        var first=Guid.NewGuid();
        await sync.Apply(Day(first,0,date,"not_logged"),default);
        var revision=await sync.Apply(Day(Guid.NewGuid(),0,date,"not_logged"),default);
        var day=await db.Days.SingleAsync();
        Assert.Equal(first,day.Id);Assert.Equal("not_logged",day.Status);Assert.Equal(revision,day.Revision);
    }

    [Fact] public async Task A_decision_queued_without_seeing_the_saved_one_keeps_the_saved_decision()
    {
        var (db,connection,user)=await Open();await using var _db=db;await using var _connection=connection;
        var sync=new SyncService(db);var date=RetentionService.Today("").AddDays(-1);
        await sync.Apply(Day(Guid.NewGuid(),0,date,"fasting"),default);
        var revision=await sync.Apply(Day(Guid.NewGuid(),0,date,"not_logged"),default);
        var day=await db.Days.SingleAsync();
        Assert.Equal("fasting",day.Status);
        // Re-stamped so the queuing device's conditional refresh returns the saved row.
        Assert.Equal(revision,day.Revision);Assert.Equal(revision,user.DiaryRevision);
    }

    [Fact] public async Task A_stale_revision_on_a_known_day_keeps_the_saved_decision()
    {
        var (db,connection,_)=await Open();await using var _db=db;await using var _connection=connection;
        var sync=new SyncService(db);var date=RetentionService.Today("").AddDays(-1);var id=Guid.NewGuid();
        var saved=await sync.Apply(Day(id,0,date,"not_logged"),default);
        await sync.Apply(Day(id,saved,date,"fasting"),default);
        var revision=await sync.Apply(Day(id,saved,date,"incomplete"),default);
        var day=await db.Days.SingleAsync();
        Assert.Equal("fasting",day.Status);Assert.Equal(revision,day.Revision);
    }

    [Fact] public async Task A_removed_row_for_the_date_accepts_the_new_decision()
    {
        var (db,connection,user)=await Open();await using var _db=db;await using var _connection=connection;
        var date=RetentionService.Today("").AddDays(-1);var saved=Guid.NewGuid();
        db.Days.Add(new DayStatus{Id=saved,UserId=user.Id,Date=date,Status="fasting",Deleted=true,Revision=3});
        await db.SaveChangesAsync();
        await new SyncService(db).Apply(Day(Guid.NewGuid(),0,date,"not_logged"),default);
        var day=await db.Days.SingleAsync();
        Assert.Equal(saved,day.Id);Assert.Equal("not_logged",day.Status);Assert.False(day.Deleted);
    }

    [Fact] public async Task A_current_decision_still_updates_the_saved_day()
    {
        var (db,connection,_)=await Open();await using var _db=db;await using var _connection=connection;
        var sync=new SyncService(db);var date=RetentionService.Today("").AddDays(-1);var id=Guid.NewGuid();
        var saved=await sync.Apply(Day(id,0,date,"not_logged"),default);
        await sync.Apply(Day(id,saved,date,"fasting"),default);
        Assert.Equal("fasting",(await db.Days.SingleAsync()).Status);
    }
}
