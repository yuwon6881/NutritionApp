using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Endpoints;
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
        var sync=new SyncService(db);var coach=new CoachingService(db,new ExpenditureTrajectoryService(db));
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

    [Fact] public void Accepted_target_intervals_carry_the_macros_stored_on_each_plan()
    {
        var today=new DateOnly(2026,9,16);
        var first=new AcceptedPlan { Date=today.AddDays(-14),ResultJson=Json.Write(new CoachResult(true,false,2000,2400,150,70,200,"first") { WeeklyCalories=14000,DailyCalories=[2000,2000,2000,2000,2000,2000,2000],ProteinFixed=true }) };
        var second=new AcceptedPlan { Date=today.AddDays(-7),ResultJson=Json.Write(new CoachResult(true,false,2200,2600,170,75,230,"second") { WeeklyCalories=15400,DailyCalories=[2200,2200,2200,2200,2200,2200,2200],ProteinFixed=false }) };

        var intervals=RecordEndpoints.BuildAcceptedTargetIntervals([first,second],today);

        Assert.Equal((150,200,70,true),(intervals[0].Protein,intervals[0].Carbs,intervals[0].Fat,intervals[0].ProteinFixed));
        Assert.Equal((170,230,75,false),(intervals[1].Protein,intervals[1].Carbs,intervals[1].Fat,intervals[1].ProteinFixed));
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

    [Fact] public async Task A_held_trajectory_keeps_the_previous_accepted_calories()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db,"held");db.CurrentUser=user.Id;
        var profile=new Profile { Age=30,HeightCm=175,WeightKg=80,Sex="male",Activity=1.4,Goal="lose",Maintenance=2500,TimeZone="UTC" };
        user.ProfileJson=Json.Write(profile);user.ProfileRevision=1;user.Revision=2;
        db.Plans.Add(AcceptedPlan(user,profile,DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-7),2200,2500));
        await db.SaveChangesAsync();

        var result=(await new CoachingService(db,new ExpenditureTrajectoryService(db)).Preview(default)).Result;

        Assert.Equal(2200,result.Calories);
    }

    [Fact] public async Task A_second_week_limits_an_adaptive_target_to_one_hundred_calories()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db,"step-limit");db.CurrentUser=user.Id;
        var profile=new Profile { Age=30,HeightCm=175,WeightKg=80,Sex="male",Activity=1.4,Goal="maintain",Maintenance=2500,TimeZone="UTC" };
        user.ProfileJson=Json.Write(profile);user.ProfileRevision=1;user.Revision=2;user.TrajectoryRevision=1;
        var today=RetentionService.Today(user.ProfileJson);
        db.Plans.Add(AcceptedPlan(user,profile,today.AddDays(-7),2500,2500));
        for(var i=1;i<=28;i++)
        {
            db.Entries.Add(new DiaryEntry { Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-i),Name="Meals",Calories=2500 });
            db.Weights.Add(new Weight { Id=Guid.NewGuid(),UserId=user.Id,Date=today.AddDays(-i),Kg=80+i*.1 });
        }
        await db.SaveChangesAsync();

        var result=(await new CoachingService(db,new ExpenditureTrajectoryService(db)).Preview(default)).Result;

        Assert.NotNull(result.Calories);
        Assert.InRange(Math.Abs(result.Calories!.Value-2500),0,100);
    }

    [Fact] public async Task Activity_change_reseeds_the_trajectory_and_moves_the_proposal()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db,"activity");db.CurrentUser=user.Id;
        var before=new Profile { Age=30,HeightCm=175,WeightKg=80,Sex="male",Activity=1.4,Goal="maintain",Maintenance=2500,TimeZone="UTC" };
        user.ProfileJson=Json.Write(before);user.ProfileRevision=1;user.Revision=2;user.TrajectoryRevision=1;
        var today=RetentionService.Today(user.ProfileJson);
        db.Plans.Add(AcceptedPlan(user,before,today.AddDays(-7),2500,2500));
        await db.SaveChangesAsync();
        var trajectory=new ExpenditureTrajectoryService(db);await trajectory.EnsureThroughToday(default);
        var after=before with { Activity=1.8 };
        user=await db.Users.SingleAsync(item=>item.Id==user.Id);user.ProfileJson=Json.Write(after);user.ProfileRevision=2;user.TrajectoryRevision=2;user.Revision=3;
        await db.SaveChangesAsync();
        await trajectory.RebuildFromUnderLock(today.AddDays(-(ExpenditureTrajectoryService.BackfillDays-1)),2,default,true);
        await db.SaveChangesAsync();

        var result=(await new CoachingService(db,trajectory).Preview(default)).Result;

        Assert.True(result.Expenditure>3000);
        Assert.True(result.Calories>2500);
    }

    [Fact] public async Task Maintenance_change_discards_the_learned_trajectory_value()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db,"maintenance");db.CurrentUser=user.Id;
        var before=new Profile { Age=30,HeightCm=175,WeightKg=80,Sex="male",Activity=1.4,Goal="maintain",Maintenance=2500,TimeZone="UTC" };
        user.ProfileJson=Json.Write(before);user.ProfileRevision=1;user.Revision=2;user.TrajectoryRevision=1;
        var today=RetentionService.Today(user.ProfileJson);
        db.Plans.Add(AcceptedPlan(user,before,today.AddDays(-7),2500,2500));
        await db.SaveChangesAsync();
        var trajectory=new ExpenditureTrajectoryService(db);await trajectory.EnsureThroughToday(default);
        var after=before with { Maintenance=3200 };
        user=await db.Users.SingleAsync(item=>item.Id==user.Id);user.ProfileJson=Json.Write(after);user.ProfileRevision=2;user.TrajectoryRevision=2;user.Revision=3;
        await db.SaveChangesAsync();
        await trajectory.RebuildFromUnderLock(today.AddDays(-(ExpenditureTrajectoryService.BackfillDays-1)),2,default,true);
        await db.SaveChangesAsync();

        var result=(await new CoachingService(db,trajectory).Preview(default)).Result;

        Assert.Equal(3200,result.Expenditure);
        Assert.Equal(3200,result.Calories);
    }

    [Fact] public async Task A_profile_edit_can_move_more_than_one_hundred_calories()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db,"profile-edit");db.CurrentUser=user.Id;
        var before=new Profile { Age=30,HeightCm=175,WeightKg=80,Sex="male",Activity=1.4,Goal="maintain",Maintenance=2500,TimeZone="UTC" };
        user.ProfileJson=Json.Write(before);user.ProfileRevision=1;user.Revision=2;user.TrajectoryRevision=1;
        var today=RetentionService.Today(user.ProfileJson);
        db.Plans.Add(AcceptedPlan(user,before,today.AddDays(-7),2500,2500));
        await db.SaveChangesAsync();
        var trajectory=new ExpenditureTrajectoryService(db);await trajectory.EnsureThroughToday(default);
        var after=before with { Maintenance=3200 };
        user=await db.Users.SingleAsync(item=>item.Id==user.Id);user.ProfileJson=Json.Write(after);user.ProfileRevision=2;user.TrajectoryRevision=2;user.Revision=3;
        await db.SaveChangesAsync();
        await trajectory.RebuildFromUnderLock(today.AddDays(-(ExpenditureTrajectoryService.BackfillDays-1)),2,default,true);
        await db.SaveChangesAsync();

        var result=(await new CoachingService(db,trajectory).Preview(default)).Result;

        Assert.True(Math.Abs(result.Calories!.Value-2500)>100);
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

    private static AcceptedPlan AcceptedPlan(AppUser user,Profile profile,DateOnly date,double calories,double expenditure)
        => new()
        {
            Id=Guid.NewGuid(),UserId=user.Id,Revision=2,Date=date,InputRevision=1,ProfileRevision=user.ProfileRevision,
            ResultJson=Json.Write(new CoachResult(true,false,calories,expenditure,150,83.3,calories==2500?312.5:275,"accepted") { EffectiveGoal=profile.Goal }),
            ProfileJson=Json.Write(profile)
        };

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
