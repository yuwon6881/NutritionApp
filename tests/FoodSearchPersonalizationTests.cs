using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Nutrition.Api.Services.FoodLookup;
using Xunit;

namespace Nutrition.Tests;

public sealed class FoodSearchPersonalizationTests
{
    [Fact]
    public void Frequency_breaks_equivalent_name_matches_without_overriding_name_relevance()
    {
        var exact=new FoodResult("Banana",100,null,null,null,null,"test");
        var frequentWeak=new FoodResult("Banana smoothie",100,null,null,null,null,"test");
        var ranked=FoodRanking.PrioritizeResults(
            [exact,frequentWeak],
            "banana",
            new Dictionary<string,int>(StringComparer.Ordinal)
            {
                [FoodRanking.UsageKey(frequentWeak)]=20,
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
        var alice=new AppUser {DisplayName="alice",IdentitySubject="sub_alice"};
        var bob=new AppUser {DisplayName="bob",IdentitySubject="sub_bob"};
        db.Users.AddRange(alice,bob);
        db.MaintenanceAccess=true;
        var entries=Enumerable.Range(0,3).Select(_=>new DiaryEntry {Id=Guid.NewGuid(),UserId=alice.Id,Name="Banana · Gamma",Source="Open Food Facts / ODbL",Calories=91})
            .Concat(Enumerable.Range(0,2).Select(_=>new DiaryEntry {Id=Guid.NewGuid(),UserId=bob.Id,Name="Banana · Alpha",Source="Open Food Facts / ODbL",Calories=89}))
            .Append(new DiaryEntry {Id=Guid.NewGuid(),UserId=alice.Id,Name="Banana · Beta",Source="Open Food Facts / ODbL",Calories=90,Deleted=true})
            .ToArray();
        db.Entries.AddRange(entries);
        await db.SaveChangesAsync();
        db.MaintenanceAccess=false;

        IReadOnlyList<FoodResult> results=[
            new("Banana · Alpha",89,null,null,null,null,"Open Food Facts / ODbL"),
            new("Banana · Beta",90,null,null,null,null,"Open Food Facts / ODbL"),
            new("Banana · Gamma",91,null,null,null,null,"Open Food Facts / ODbL")
        ];

        db.CurrentUser=alice.Id;
        var aliceResults=await FoodRanking.RankForUser(results,"banana",db,default);
        db.CurrentUser=bob.Id;
        var bobResults=await FoodRanking.RankForUser(results,"banana",db,default);

        Assert.Equal("Banana · Gamma",aliceResults[0].Name);
        Assert.Equal("Banana · Alpha",bobResults[0].Name);
    }

    [Fact]
    public async Task Barcoded_results_rank_by_their_own_frequency_not_their_providers()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user=await TestUsers.CreateAsync(db,"coded-frequency");
        db.CurrentUser=user.Id;
        db.Entries.AddRange(Enumerable.Range(0,3).Select(_=>new DiaryEntry {Id=Guid.NewGuid(),UserId=user.Id,Name="Banana · Gamma",Source="Open Food Facts / ODbL",Calories=91}));
        await db.SaveChangesAsync();

        IReadOnlyList<FoodResult> results=[
            new("Banana · Alpha",89,null,null,null,null,"Open Food Facts / ODbL",Code:"111"),
            new("Banana · Beta",90,null,null,null,null,"Open Food Facts / ODbL",Code:"222"),
            new("Banana · Gamma",91,null,null,null,null,"Open Food Facts / ODbL",Code:"333")
        ];

        var ranked=await FoodRanking.RankForUser(results,"banana",db,default);

        Assert.Equal("Banana · Gamma",ranked[0].Name);
    }

    [Fact]
    public void Foods_the_query_names_precede_products_that_only_start_with_the_word()
    {
        FoodResult Food(string name,bool generic=true)=>new(name,130,null,null,null,null,"test",IsGeneric:generic);
        var cake=Food("Rice cake");
        var crackers=Food("Rice crackers");
        var flour=Food("Rice flour, white, unenriched");
        var brown=Food("Rice, brown, cooked");
        var logged=Food("White Rice",generic:false);
        var plain=Food("Rice");

        var ranked=FoodRanking.PrioritizeResults(
            [cake,crackers,flour,brown,logged,plain],
            "rice",
            new Dictionary<string,int>(StringComparer.Ordinal){[FoodRanking.UsageKey(logged)]=3});

        // Exact match first within the foods named "rice"; the logged food leads the rest of them.
        Assert.Equal(["White Rice","Rice","Rice, brown, cooked"],ranked.Take(3).Select(result=>result.Name));
        Assert.Equal(["Rice cake","Rice crackers","Rice flour, white, unenriched"],ranked.Skip(3).Select(result=>result.Name));
    }

    [Fact]
    public void A_logged_food_leads_the_foods_a_multi_word_query_names()
    {
        var generic=new FoodResult("Rice, white, long-grain, cooked",130,null,null,null,null,"test",IsGeneric:true);
        var logged=new FoodResult("White Rice",130,null,null,null,null,"test");
        var derived=new FoodResult("White rice flour",360,null,null,null,null,"test");

        var ranked=FoodRanking.PrioritizeResults(
            [derived,generic,logged],
            "white rice",
            new Dictionary<string,int>(StringComparer.Ordinal){[FoodRanking.UsageKey(logged)]=2});

        Assert.Equal(["White Rice","Rice, white, long-grain, cooked","White rice flour"],ranked.Select(result=>result.Name));
    }
}
