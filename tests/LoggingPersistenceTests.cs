using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using System.Text.Json;
using Xunit;
namespace Nutrition.Tests;

public class LoggingPersistenceTests
{
    [Fact] public async Task An_old_day_with_food_accepts_not_logged_but_rejects_false_fasting()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db, "alice");db.CurrentUser=user.Id;
        var date=ProfileClock.Today("").AddDays(-200);
        db.Entries.Add(new DiaryEntry{Id=Guid.NewGuid(),UserId=user.Id,Date=date,Name="Rice",Calories=1234});
        var day=new DayStatus{Id=Guid.NewGuid(),UserId=user.Id,Date=date,Status="complete"};
        db.Days.Add(day);await db.SaveChangesAsync();
        var sync=new SyncService(db);
        var revision=await sync.Apply(new(Guid.NewGuid(),"day",day.Id,0,JsonSerializer.SerializeToElement(new{date,status="not_logged"})),default);
        Assert.Equal("not_logged",day.Status);
        await Assert.ThrowsAsync<DomainException>(()=>sync.Apply(new(Guid.NewGuid(),"day",day.Id,revision,JsonSerializer.SerializeToElement(new{date,status="fasting"})),default));
    }

    [Fact] public async Task Coaching_uses_elapsed_food_days_without_manual_completion()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db, "alice");db.CurrentUser=user.Id;
        user.ProfileJson=Json.Write(new Profile{Age=30,HeightCm=175,WeightKg=80,Sex="male",Activity=1.4,Goal="maintain",Maintenance=2500});
        var today=ProfileClock.Today(user.ProfileJson);
        for(var i=1;i<=28;i++){
            db.Entries.Add(new DiaryEntry{Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-i),Name="Meals",Calories=2500});
            db.Weights.Add(new Weight{Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-i),Kg=80});
        }
        await db.SaveChangesAsync();var coach=new CoachingService(db,new ExpenditureTrajectoryService(db));
        Assert.True((await coach.Preview(default)).Result.Adaptive);
        db.Days.Add(new DayStatus{Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-1),Status="not_logged"});await db.SaveChangesAsync();
        var result=(await coach.Preview(default)).Result;
        Assert.True(result.Adaptive);Assert.NotNull(result.Expenditure);Assert.Equal(28,await db.Weights.CountAsync());
    }
}
