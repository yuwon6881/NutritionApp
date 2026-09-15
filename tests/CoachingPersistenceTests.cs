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
        var alice = await TestUsers.CreateAsync(setup, "trajectory-alice");
        var bob = await TestUsers.CreateAsync(setup, "trajectory-bob");
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
        var user = await TestUsers.CreateAsync(db, "trajectory-mutations");
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
            JsonSerializer.SerializeToElement(new { date, name = "Rice", calories = 500, quantity = 1, unit = "serving" }, Json.Options)), default);

        var snapshots = await trajectory.EnsureThroughToday(default);
        Assert.Equal(ExpenditureTrajectoryService.BackfillDays, snapshots.Count);
        Assert.Equal(ExpenditureTrajectoryService.BackfillDays, snapshots.Select(snapshot => snapshot.Date).Distinct().Count());
        Assert.All(snapshots, snapshot => Assert.Equal(revision, snapshot.SourceRevision));
    }

    [Fact] public async Task Preview_rejects_stale_acceptance_and_accepted_history_survives_corrections()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db, "alice");db.CurrentUser=user.Id;
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
        await sync.Apply(new(Guid.NewGuid(),"entry",Guid.NewGuid(),0,JsonSerializer.SerializeToElement(new { date=date.AddDays(-1),name="Rice",calories=100,quantity=100,unit="g" })),default);
        Assert.Equal(original,(await db.Plans.SingleAsync()).ResultJson);
    }
    [Fact] public async Task A_trajectory_backed_proposal_keeps_one_calorie_target_across_a_completed_phase()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db, "alice");db.CurrentUser=user.Id;
        user.ProfileJson=Json.Write(new Profile { Age=30,HeightCm=175,WeightKg=78,Sex="male",Activity=1.4,Goal="lose",
            Maintenance=2500,PhaseMode="weight",TargetWeightKg=79,PhaseStartWeightKg=82,GoalRatePercent=-.5,TimeZone="UTC" });
        user.ProfileRevision=++user.Revision;
        var today=RetentionService.Today(user.ProfileJson);
        for(var i=1;i<=28;i++){
            db.Entries.Add(new DiaryEntry{Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-i),Name="Meals",Calories=2500});
            db.Weights.Add(new Weight{Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-i),Kg=78});
        }
        db.PhaseDecisions.Add(new PhaseDecision{Id=Guid.NewGuid(),UserId=user.Id,Date=today,ProfileRevision=user.ProfileRevision,
            Decision="completed",ReachedBy="scale",Revision=++user.Revision});
        await db.SaveChangesAsync();

        var result=(await new CoachingService(db,new ExpenditureTrajectoryService(db)).Preview(default)).Result;
        Assert.True(result.Adaptive);Assert.True(result.PhaseComplete);Assert.Equal("maintain",result.EffectiveGoal);
        // A completed phase ends the deficit, and every derived figure follows the same target.
        Assert.InRange(result.Calories!.Value,2400,2600);
        Assert.Equal(result.Calories!.Value*7,result.WeeklyCalories);
        Assert.Equal((int)Math.Round(result.WeeklyCalories!.Value),result.DailyCalories!.Sum());
        Assert.InRange(result.Protein!.Value*4+result.Fat!.Value*9+result.Carbs!.Value*4,result.Calories!.Value-2,result.Calories!.Value+2);
    }

    [Fact] public async Task Deleting_a_historical_weigh_in_rebuilds_the_trajectory_from_its_own_date()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db, "alice");db.CurrentUser=user.Id;
        var trajectory=new ExpenditureTrajectoryService(db);var sync=new SyncService(db,trajectory:trajectory);
        await sync.Apply(new(Guid.NewGuid(),"profile",user.Id,0,JsonSerializer.SerializeToElement(
            new Profile { Age=30,HeightCm=175,WeightKg=80,Sex="male",Activity=1.4,Goal="maintain",Maintenance=2500,TimeZone="UTC" },Json.Options)),default);
        var date=RetentionService.Today(user.ProfileJson).AddDays(-40);
        var id=Guid.NewGuid();
        var added=await sync.Apply(new(Guid.NewGuid(),"weight",id,0,JsonSerializer.SerializeToElement(new { date,kg=79.5 })),default);
        // A delete carries no date of its own, so the stored date has to drive the rebuild.
        var deleted=await sync.Apply(new(Guid.NewGuid(),"weight",id,added,JsonSerializer.SerializeToElement(new {}),true),default);

        var snapshots=await db.ExpenditureEstimates.AsNoTracking().OrderBy(snapshot=>snapshot.Date).ToListAsync();
        Assert.Equal(date,snapshots.Where(snapshot=>snapshot.SourceRevision==deleted).Min(snapshot=>snapshot.Date));
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
