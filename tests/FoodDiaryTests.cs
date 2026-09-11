using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using System.Text.Json;
using Xunit;

namespace Nutrition.Tests;

public class FoodDiaryTests
{
    private static async Task WithDiary(Func<AppDb,AppUser,IConfiguration,Task> action)
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var config=new ConfigurationBuilder().Build();
        var user=await new AuthService(db,config).Register("alice","a long test password",default);
        db.CurrentUser=user.Id;
        await action(db,user,config);
    }

    [Fact] public Task Quick_add_keeps_time_unknown_macros_and_idempotency()=>WithDiary(async(db,user,config)=>
    {
        var sync=new SyncService(db,null,new RetentionService(db,config));
        var date=RetentionService.Today(user.ProfileJson);
        var op=new Mutation(Guid.NewGuid(),"entry",Guid.NewGuid(),0,JsonSerializer.SerializeToElement(new {date,time="00:00",name="Quick add",calories=450,quantity=1,unit="serving",source="Quick add"}));
        var revision=await sync.Apply(op,default);
        Assert.Equal(revision,await sync.Apply(op,default));
        var entry=await db.Entries.SingleAsync();
        Assert.Equal("00:00",entry.Time);Assert.Equal(450,entry.Calories);
        Assert.Null(entry.Protein);Assert.Null(entry.Carbs);Assert.Null(entry.Fat);Assert.Null(entry.Fiber);
        // An older client without the new field must not erase a saved time.
        await sync.Apply(new(Guid.NewGuid(),"entry",entry.Id,revision,JsonSerializer.SerializeToElement(new {date,name="Quick add",calories=500})),default);
        Assert.Equal("00:00",entry.Time);Assert.Equal(500,entry.Calories);
    });

    [Theory]
    [InlineData("24:00")][InlineData("12:60")][InlineData("9:00")][InlineData("12:00\n")]
    public Task Invalid_time_is_rejected(string time)=>WithDiary(async(db,user,config)=>
    {
        var sync=new SyncService(db,null,new RetentionService(db,config));
        var date=RetentionService.Today(user.ProfileJson);
        await Assert.ThrowsAsync<DomainException>(()=>sync.Apply(new(Guid.NewGuid(),"entry",Guid.NewGuid(),0,JsonSerializer.SerializeToElement(new {date,time,name="Meal",calories=300})),default));
        Assert.Empty(await db.Entries.ToListAsync());
    });

    [Fact] public Task Default_retention_keeps_90_calendar_days_and_preserves_rollups()=>WithDiary(async(db,user,config)=>
    {
        var today=RetentionService.Today(user.ProfileJson);
        var retention=new RetentionService(db,config);Assert.Equal(90,retention.DetailDays);
        db.Entries.AddRange(
            new DiaryEntry{Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-89),Name="Kept",Calories=200,Time="23:59"},
            new DiaryEntry{Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-90),Name="Quick add",Calories=450,Time="12:00"});
        await db.SaveChangesAsync();
        Assert.Equal(1,await retention.CompactUser(user.Id,today,default));
        Assert.Equal("Kept",(await db.Entries.SingleAsync()).Name);
        var summary=await db.Days.SingleAsync();Assert.True(summary.Archived);Assert.Equal(450,summary.Calories);Assert.Null(summary.Protein);
        Assert.Equal(0,await retention.CompactUser(user.Id,today,default));
    });

    [Fact] public Task Previously_archived_days_stay_read_only_inside_extended_retention()=>WithDiary(async(db,user,config)=>
    {
        var date=RetentionService.Today(user.ProfileJson).AddDays(-12);
        var day=new DayStatus{Id=Guid.NewGuid(),UserId=user.Id,Date=date,Archived=true,Calories=450,EntryCount=1,Status="complete"};
        db.Days.Add(day);await db.SaveChangesAsync();
        var sync=new SyncService(db,null,new RetentionService(db,config));
        var error=await Assert.ThrowsAsync<DomainException>(()=>sync.Apply(new(Guid.NewGuid(),"entry",Guid.NewGuid(),0,JsonSerializer.SerializeToElement(new {date,time="12:00",name="Meal",calories=300})),default));
        Assert.Equal(409,error.Status);
        await sync.Apply(new(Guid.NewGuid(),"day",day.Id,day.Revision,JsonSerializer.SerializeToElement(new {date,status="not_logged"})),default);
        Assert.True(day.Archived);Assert.Equal(450,day.Calories);Assert.Equal(1,day.EntryCount);Assert.Null(day.Protein);
    });

    [Fact] public Task Time_only_move_preserves_entry_and_resets_day_status()=>WithDiary(async(db,user,config)=>
    {
        var sync=new SyncService(db,null,new RetentionService(db,config));
        var date=RetentionService.Today(user.ProfileJson);
        var entryId=Guid.NewGuid();
        var original=new DiaryEntry{
            Id=entryId,UserId=user.Id,Date=date,Time="08:00",Name="Breakfast",
            Calories=400,Protein=25,Carbs=30,Fat=12,Fiber=5,Quantity=1.5,Unit="serving",Source="Manual"
        };
        db.Entries.Add(original);
        db.Days.Add(new DayStatus{Id=Guid.NewGuid(),UserId=user.Id,Date=date,Status="fasting"});
        await db.SaveChangesAsync();

        var op=new Mutation(Guid.NewGuid(),"entry",entryId,0,JsonSerializer.SerializeToElement(new {
            date,time="12:30",name="Breakfast",calories=400,protein=25,carbs=30,fat=12,fiber=5,quantity=1.5,unit="serving",source="Manual"
        }));
        var revision=await sync.Apply(op,default);
        Assert.True(revision>0);

        var entry=await db.Entries.SingleAsync(e=>e.Id==entryId);
        Assert.Equal("12:30",entry.Time);
        Assert.Equal("Breakfast",entry.Name);
        Assert.Equal(400,entry.Calories);
        Assert.Equal(25,entry.Protein);
        Assert.Equal(30,entry.Carbs);
        Assert.Equal(12,entry.Fat);
        Assert.Equal(5,entry.Fiber);
        Assert.Equal(1.5,entry.Quantity);
        Assert.Equal("serving",entry.Unit);
        Assert.Equal(revision,entry.Revision);

        var day=await db.Days.SingleAsync(d=>d.Date==date);
        Assert.Equal("incomplete",day.Status);

        var staleOp=new Mutation(Guid.NewGuid(),"entry",entryId,0,JsonSerializer.SerializeToElement(new {
            date,time="18:00",name="Breakfast",calories=400
        }));
        var ex=await Assert.ThrowsAsync<DomainException>(()=>sync.Apply(staleOp,default));
        Assert.Equal(409,ex.Status);
    });
}
