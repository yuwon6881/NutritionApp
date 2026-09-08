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
    }
}
