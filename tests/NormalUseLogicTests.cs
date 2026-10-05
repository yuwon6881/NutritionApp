using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;
namespace Nutrition.Tests;
public sealed class NormalUseLogicTests
{
    private static async Task<AppDb> Open(){
        var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options);
        await db.Database.OpenConnectionAsync();await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db,"normal-use");db.CurrentUser=user.Id;return db;
    }
    private static Mutation Op(string kind,Guid id,long revision,object data,bool delete=false)
        =>new(Guid.NewGuid(),kind,id,revision,JsonSerializer.SerializeToElement(data,Json.Options),delete);
    [Fact] public async Task Deleted_weight_is_restored_using_its_reserved_identity(){
        await using var db=await Open();var sync=new SyncService(db);var date=RetentionService.Today("");var id=Guid.NewGuid();
        var revision=await sync.Apply(Op("weight",id,0,new{date,kg=80}),default);
        revision=await sync.Apply(Op("weight",id,revision,new{date,kg=80},true),default);
        var replacement=Op("weight",Guid.NewGuid(),0,new{date,kg=81});
        var restored=await sync.Apply(replacement,default);
        Assert.Equal(restored,await sync.Apply(replacement,default));
        var row=await db.Weights.SingleAsync();Assert.Equal(id,row.Id);Assert.False(row.Deleted);Assert.Equal(81,row.Kg);
        await sync.Apply(Op("weight",id,restored,new{date=date.AddDays(-1),kg=82}),default);
        var replay=await SyncWriteResults.Read(db,replacement,restored,default);
        Assert.Equal(id,Assert.Single(replay.Weights!).Id);Assert.Equal(date,replay.Weights![0].Date);
        Assert.Equal(restored,replay.Weights[0].Revision);
    }
    [Fact] public async Task Weight_move_rejection_keeps_both_records_and_valid_move_is_idempotent(){
        await using var db=await Open();var sync=new SyncService(db);var date=RetentionService.Today("");var a=Guid.NewGuid();var b=Guid.NewGuid();
        var ar=await sync.Apply(Op("weight",a,0,new{date=date.AddDays(-1),kg=80}),default);
        var br=await sync.Apply(Op("weight",b,0,new{date,kg=81}),default);
        await Assert.ThrowsAsync<DomainException>(()=>sync.Apply(Op("weight_move",a,ar,new{date,kg=82,destinationId=b,destinationRevision=0}),default));
        Assert.False((await db.Weights.SingleAsync(w=>w.Id==a)).Deleted);Assert.Equal(81,(await db.Weights.SingleAsync(w=>w.Id==b)).Kg);
        var move=Op("weight_move",a,ar,new{date,kg=82,destinationId=b,destinationRevision=br});
        var revision=await sync.Apply(move,default);Assert.Equal(revision,await sync.Apply(move,default));
        Assert.True((await db.Weights.SingleAsync(w=>w.Id==a)).Deleted);Assert.Equal(82,(await db.Weights.SingleAsync(w=>w.Id==b)).Kg);
    }
    [Fact] public async Task Preferences_do_not_change_cadence_but_weekday_changes_do(){
        await using var db=await Open();var user=await db.Users.SingleAsync();var sync=new SyncService(db);
        var today=RetentionService.Today("");
        db.Plans.Add(new AcceptedPlan{Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-14),Revision=0,ProfileRevision=0,CheckInWeekday=1});await db.SaveChangesAsync();
        var revision=await sync.Apply(Op("settings",user.Id,0,new{weightUnit="lb"}),default);
        Assert.Equal(0,user.CadenceRevision);Assert.Null(user.CadenceChangedDate);
        await sync.Apply(Op("settings",user.Id,revision,new{checkInWeekday=5}),default);
        Assert.Equal(user.Revision,user.CadenceRevision);Assert.Equal(today,user.CadenceChangedDate);
    }
    [Fact] public void Database_failure_is_retryable_unless_it_is_a_known_constraint(){
        Assert.False(DatabaseWriteErrors.IsConflict(new DbUpdateException("connection reset")));
        Assert.True(DatabaseWriteErrors.IsConflict(new DbUpdateException("constraint",new Microsoft.Data.Sqlite.SqliteException("unique",19))));
    }
}
