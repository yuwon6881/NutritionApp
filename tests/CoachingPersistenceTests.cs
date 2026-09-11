using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using System.Text.Json;
using Xunit;
namespace Nutrition.Tests;
public class CoachingPersistenceTests
{
    [Fact]
    public async Task Trajectory_backfill_is_serialized_and_scoped_to_the_current_user()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options;
        await using var setup = new AppDb(options);
        await setup.Database.EnsureCreatedAsync();
        var auth = new AuthService(setup, new ConfigurationBuilder().Build());
        var alice = await auth.Register("trajectory-alice", "a very long test password", default);
        var bob = await auth.Register("trajectory-bob", "a very long test password", default);
        var profile = new Profile
        {
            Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4,
            Goal = "maintain", Maintenance = 2500, TimeZone = "UTC"
        };
        alice.ProfileJson = Json.Write(profile); alice.ProfileRevision = 1;
        bob.ProfileJson = Json.Write(profile); bob.ProfileRevision = 1;
        await setup.SaveChangesAsync();

        await using var first = new AppDb(options) { CurrentUser = alice.Id };
        await using var second = new AppDb(options) { CurrentUser = alice.Id };
        var results = await Task.WhenAll(
            new ExpenditureTrajectoryService(first).EnsureThroughToday(default),
            new ExpenditureTrajectoryService(second).EnsureThroughToday(default));

        Assert.All(results, snapshots => Assert.Equal(ExpenditureTrajectoryService.BackfillDays, snapshots.Count));
        await using var aliceRead = new AppDb(options) { CurrentUser = alice.Id };
        Assert.Equal(ExpenditureTrajectoryService.BackfillDays, await aliceRead.ExpenditureEstimates.CountAsync());
        Assert.All(await aliceRead.ExpenditureEstimates.ToListAsync(), snapshot => Assert.Equal(alice.Id, snapshot.UserId));

        await using var bobRead = new AppDb(options) { CurrentUser = bob.Id };
        var bobSnapshots = await new ExpenditureTrajectoryService(bobRead).EnsureThroughToday(default);
        Assert.Equal(ExpenditureTrajectoryService.BackfillDays, bobSnapshots.Count);
        Assert.All(bobSnapshots, snapshot => Assert.Equal(bob.Id, snapshot.UserId));
        Assert.Equal(ExpenditureTrajectoryService.BackfillDays, await bobRead.ExpenditureEstimates.CountAsync());
    }

    [Fact]
    public async Task Rebuilding_trajectory_after_two_mutations_does_not_duplicate_dates()
    {
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options;
        await using var db = new AppDb(options);
        await db.Database.EnsureCreatedAsync();
        var user = await new AuthService(db, new ConfigurationBuilder().Build())
            .Register("trajectory-mutations", "a very long test password", default);
        db.CurrentUser = user.Id;
        var profile = new Profile
        {
            Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4,
            Goal = "maintain", Maintenance = 2500, TimeZone = "UTC"
        };
        var trajectory = new ExpenditureTrajectoryService(db);
        var sync = new SyncService(db, trajectory: trajectory);
        var revision = await sync.Apply(new(Guid.NewGuid(), "profile", user.Id, 0,
            JsonSerializer.SerializeToElement(profile, Json.Options)), default);
        var date = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);
        revision = await sync.Apply(new(Guid.NewGuid(), "entry", Guid.NewGuid(), 0,
            JsonSerializer.SerializeToElement(new { date, name = "Rice", calories = 500, meal = "Lunch", quantity = 1, unit = "serving" }, Json.Options)), default);

        var snapshots = await trajectory.EnsureThroughToday(default);
        Assert.Equal(ExpenditureTrajectoryService.BackfillDays, snapshots.Count);
        Assert.Equal(ExpenditureTrajectoryService.BackfillDays, snapshots.Select(snapshot => snapshot.Date).Distinct().Count());
        Assert.All(snapshots, snapshot => Assert.Equal(revision, snapshot.SourceRevision));
    }

    [Fact] public async Task Preview_rejects_stale_acceptance_and_accepted_history_survives_corrections()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var user=await new AuthService(db,new ConfigurationBuilder().Build()).Register("alice","a very long test password",default);db.CurrentUser=user.Id;
        var sync=new SyncService(db);var coach=new CoachingService(db);
        var profile=new Profile { Age=30,HeightCm=175,WeightKg=80,Sex="male",Activity=1.4,Goal="maintain",Maintenance=2500 };
        await sync.Apply(new(Guid.NewGuid(),"profile",user.Id,0,JsonSerializer.SerializeToElement(profile,Json.Options)),default);
        var preview=await coach.Preview(default);
        var date=DateOnly.FromDateTime(DateTime.UtcNow);
        await sync.Apply(new(Guid.NewGuid(),"weight",Guid.NewGuid(),0,JsonSerializer.SerializeToElement(new { date,kg=79 })),default);
        await Assert.ThrowsAsync<DomainException>(()=>coach.Accept(Guid.NewGuid(),preview.Revision,default));
        preview=await coach.Preview(default);var id=Guid.NewGuid();var plan=await coach.Accept(id,preview.Revision,default);var original=plan.ResultJson;
        Assert.Equal(id,(await coach.Accept(id,preview.Revision,default)).Id);
        Assert.False((await coach.Preview(default)).CanAccept);
        await sync.Apply(new(Guid.NewGuid(),"entry",Guid.NewGuid(),0,JsonSerializer.SerializeToElement(new { date=date.AddDays(-1),name="Rice",calories=100,meal="Lunch",quantity=100,unit="g" })),default);
        Assert.Equal(original,(await db.Plans.SingleAsync()).ResultJson);
    }
    [Fact] public void Ai_validation_preserves_unknowns_and_rejects_negative_values()
    {
        var food=new AiFood("Nasi lemak",1,"serving",500,null,20,60,null,"Portion uncertain");
        NutritionAi.Validate(new([food],["How much rice?"],"Estimate"));Assert.Null(food.Protein);
        Assert.Throws<DomainException>(()=>NutritionAi.Validate(new([food with { Calories=-1 }],[],"Estimate")));
        Assert.Throws<DomainException>(()=>NutritionAi.Validate(new([food with { Quantity=double.NaN }],[],"Estimate")));
        Assert.Throws<DomainException>(()=>NutritionAi.Validate(new([food with { PortionLabel="bowl" }],[],"Estimate")));
        Assert.Throws<DomainException>(()=>NutritionAi.Validate(new([food with { Unit="g",PortionLabel="bowl",PortionGrams=150 }],[],"Estimate")));
        NutritionAi.Validate(new([food with { PortionLabel="bowl",PortionGrams=150 }],[],"Estimate"));
    }
}
