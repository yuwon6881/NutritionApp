using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public class PlanSexPersistenceTests
{
    [Fact]
    public async Task Switching_to_male_clears_pregnancy_at_the_persistence_boundary_and_retries_are_safe()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db, "sex-contract");
        db.CurrentUser=user.Id;
        var profile=new Profile { Age=30,Sex="female",HeightCm=170,WeightKg=70,Activity=1.4,Goal="maintain",PregnancyOrBreastfeeding=true };
        var sync=new SyncService(db);
        async Task<long> Save(Profile p,long revision)=>await sync.Apply(new Mutation(Guid.NewGuid(),"profile",user.Id,revision,JsonSerializer.SerializeToElement(p,Json.Options)),default);
        var revision=await Save(profile,0);
        Assert.True(Json.Read<Profile>(user.ProfileJson).PregnancyOrBreastfeeding);
        Assert.Throws<DomainException>(()=>Validation.Profile(profile with {Sex="male"}));
        var operation=new Mutation(Guid.NewGuid(),"profile",user.Id,revision,JsonSerializer.SerializeToElement(profile with {Sex="male"},Json.Options));
        revision=await sync.Apply(operation,default);
        Assert.Equal(revision,await sync.Apply(operation,default));
        var saved=Json.Read<Profile>(user.ProfileJson);
        Assert.False(saved.PregnancyOrBreastfeeding);
        await Save(saved with {Sex="female"},revision);
        Assert.False(Json.Read<Profile>(user.ProfileJson).PregnancyOrBreastfeeding);
        await Save(profile,user.ProfileRevision);
        Assert.True(Json.Read<Profile>(user.ProfileJson).PregnancyOrBreastfeeding);
    }
}
