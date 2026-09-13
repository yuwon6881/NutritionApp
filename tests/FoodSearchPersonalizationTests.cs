using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class FoodSearchPersonalizationTests
{
    [Fact]
    public void Frequency_breaks_equivalent_name_matches_without_overriding_name_relevance()
    {
        var exact=new FoodResult("Banana",100,null,null,null,null,"test");
        var frequentWeak=new FoodResult("Banana smoothie",100,null,null,null,null,"test");
        var ranked=FoodSearchService.PrioritizeResults(
            [exact,frequentWeak],
            "banana",
            new Dictionary<string,int>(StringComparer.Ordinal)
            {
                [FoodSearchService.UsageKey(frequentWeak)]=20,
            });

        Assert.Equal([exact.Name,frequentWeak.Name],ranked.Select(result=>result.Name));
    }

    [Fact]
    public async Task Ranking_moves_a_frequently_logged_third_row_ahead_and_is_account_scoped()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var alice=new AppUser {Username="alice",PasswordHash="hash-a",Slot=1};
        var bob=new AppUser {Username="bob",PasswordHash="hash-b",Slot=2};
        db.Users.AddRange(alice,bob);
        db.MaintenanceAccess=true;
        var entries=Enumerable.Range(0,3).Select(_=>new DiaryEntry {Id=Guid.NewGuid(),UserId=alice.Id,Name="Banana · Gamma",Source="Open Food Facts / ODbL",Calories=91})
            .Concat(Enumerable.Range(0,2).Select(_=>new DiaryEntry {Id=Guid.NewGuid(),UserId=bob.Id,Name="Banana · Alpha",Source="Open Food Facts / ODbL",Calories=89}))
            .Append(new DiaryEntry {Id=Guid.NewGuid(),UserId=alice.Id,Name="Banana · Beta",Source="Open Food Facts / ODbL",Calories=90,Deleted=true})
            .ToArray();
        db.Entries.AddRange(entries);
        await db.SaveChangesAsync();
        db.MaintenanceAccess=false;

        var service=new FoodSearchService(
            new HttpClient(new HttpClientHandler()),
            new MemoryCache(new MemoryCacheOptions {SizeLimit=256}));
        IReadOnlyList<FoodResult> results=[
            new("Banana · Alpha",89,null,null,null,null,"Open Food Facts / ODbL"),
            new("Banana · Beta",90,null,null,null,null,"Open Food Facts / ODbL"),
            new("Banana · Gamma",91,null,null,null,null,"Open Food Facts / ODbL")
        ];

        db.CurrentUser=alice.Id;
        var aliceResults=await service.RankForUser(results,"banana",db,default);
        db.CurrentUser=bob.Id;
        var bobResults=await service.RankForUser(results,"banana",db,default);

        Assert.Equal("Banana · Gamma",aliceResults[0].Name);
        Assert.Equal("Banana · Alpha",bobResults[0].Name);
    }
}
