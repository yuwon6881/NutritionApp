using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services.FoodLookup;
using Xunit;
using static Nutrition.Tests.FoodResultsFor;

namespace Nutrition.Tests;

/// <summary>
/// Foods the account has already logged come back first when searched for again, are added when
/// the public catalogue omits them, and still answer when every provider is down.
/// </summary>
public sealed class FoodSearchLoggedFoodsTests : IAsyncLifetime
{
    private const string Yoghurt="9300633603526";
    private const string YoghurtSource="Open Food Facts / ODbL / "+Yoghurt;
    private readonly Microsoft.Data.Sqlite.SqliteConnection connection=new("Data Source=:memory:");
    private AppDb Db()=>new(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);

    public async Task InitializeAsync()
    {
        await connection.OpenAsync();
        await using var db=Db();
        await db.Database.EnsureCreatedAsync();
    }

    public async Task DisposeAsync()=>await connection.DisposeAsync();

    private static FoodCatalog Catalog(params IFoodProvider[] providers)
        =>new(providers,new MemoryCache(new MemoryCacheOptions{SizeLimit=256}));

    private static DiaryEntry Entry(Guid userId,string name,string source,double calories,double quantity,string unit="g",DateOnly? date=null)
        =>new() {Id=Guid.NewGuid(),UserId=userId,Name=name,Source=source,Calories=calories,Quantity=quantity,Unit=unit,Date=date??new DateOnly(2026,10,19)};

    [Fact]
    public void A_logged_entry_rebuilds_per_100_values_from_its_weighed_amount()
    {
        var entry=new DiaryEntry {Name="Greek Style Yoghurt · Lactel",Source=YoghurtSource,Calories=286,Protein=14,Carbs=23.8,Fat=14.8,Quantity=280,Unit="g"};

        var food=LoggedFoods.FromEntry(entry)!;

        Assert.Equal(102.14,food.Calories);
        Assert.Equal(5,food.Protein);
        Assert.Null(food.Fiber);
        Assert.Equal(Yoghurt,food.Code);
        Assert.Equal("per100g",food.Basis);
    }

    [Fact]
    public void A_serving_without_its_weight_is_not_rescaled()
        =>Assert.Null(LoggedFoods.FromEntry(new DiaryEntry {Name="Chicken rice",Source="AI estimate",Calories=600,Quantity=1,Unit="serving"}));

    [Fact]
    public async Task An_earlier_weighed_entry_rebuilds_a_food_whose_newest_entry_has_no_weight()
    {
        await using var db=Db();
        var user=await TestUsers.CreateAsync(db,"weighed-earlier");
        db.CurrentUser=user.Id;
        db.Entries.AddRange(
            Entry(user.Id,"Chicken rice","manual",600,300,date:new DateOnly(2026,10,10)),
            Entry(user.Id,"Chicken rice","manual",650,1,"serving",new DateOnly(2026,10,19)));
        await db.SaveChangesAsync();

        var results=await LoggedFoods.Matching("chicken rice",db,default);

        var food=Assert.Single(results);
        Assert.Equal(200,food.Calories);
    }

    [Fact]
    public async Task A_logged_food_the_provider_omits_is_added_first_and_only_for_its_account()
    {
        await using var db=Db();
        var alice=await TestUsers.CreateAsync(db,"alice");
        var bob=await TestUsers.CreateAsync(db,"bob");
        db.MaintenanceAccess=true;
        db.Entries.AddRange(
            Entry(alice.Id,"Greek Style Yoghurt · Lactel",YoghurtSource,286,280),
            new DiaryEntry {Id=Guid.NewGuid(),UserId=alice.Id,Name="Lactel greek dessert",Source="manual",Calories=200,Quantity=100,Unit="g",Deleted=true});
        await db.SaveChangesAsync();
        db.MaintenanceAccess=false;
        var provider=new FakeFoodProvider("off"){OnSearch=_=>[Branded("Lactel bio · Lactel","3428274200259"),Branded("Tuna greek","5204458013048")]};
        var catalog=Catalog(provider);

        db.CurrentUser=alice.Id;
        var aliceResults=await catalog.Search("lactel greek",db,default);
        db.CurrentUser=bob.Id;
        var bobResults=await catalog.Search("lactel greek",db,default);

        Assert.Equal("Greek Style Yoghurt · Lactel",aliceResults[0].Name);
        Assert.DoesNotContain(aliceResults,result=>result.Name=="Lactel greek dessert");
        Assert.DoesNotContain(bobResults,result=>result.Name=="Greek Style Yoghurt · Lactel");
    }

    [Fact]
    public async Task A_provider_row_with_the_logged_barcode_takes_the_logged_name_and_leads()
    {
        await using var db=Db();
        var user=await TestUsers.CreateAsync(db,"barcode-name");
        db.CurrentUser=user.Id;
        db.Entries.Add(Entry(user.Id,"Greek Yoghurt · Lactel",YoghurtSource,100,100));
        await db.SaveChangesAsync();
        var provider=new FakeFoodProvider("off"){OnSearch=_=>[Branded("Greek yoghurt plain","1234567890128"),Branded("Greek Style Yoghurt · Lactel",Yoghurt)]};

        var results=await Catalog(provider).Search("greek yoghurt",db,default);

        Assert.Equal("Greek Yoghurt · Lactel",results[0].Name);
        Assert.Equal(2,results.Count);
    }

    [Fact]
    public async Task A_logged_food_the_provider_also_returns_is_not_duplicated()
    {
        await using var db=Db();
        var user=await TestUsers.CreateAsync(db,"no-duplicate");
        db.CurrentUser=user.Id;
        db.Entries.Add(Entry(user.Id,"Greek Style Yoghurt · Lactel",YoghurtSource,286,280));
        await db.SaveChangesAsync();
        var provider=new FakeFoodProvider("off"){OnSearch=_=>[Branded("Greek Style Yoghurt · Lactel",Yoghurt,102),Branded("Greek yoghurt plain","1234567890128")]};

        var results=await Catalog(provider).Search("greek yoghurt",db,default);

        Assert.Single(results,result=>result.Name=="Greek Style Yoghurt · Lactel");
        Assert.Equal(102,results[0].Calories);
    }

    [Fact]
    public async Task At_most_five_logged_foods_are_added_and_the_most_logged_come_first()
    {
        await using var db=Db();
        var user=await TestUsers.CreateAsync(db,"cap");
        db.CurrentUser=user.Id;
        for(var food=1;food<=7;food++)
            for(var time=0;time<food;time++)
                db.Entries.Add(Entry(user.Id,$"Oat bar {food}","manual",200,50,date:new DateOnly(2026,10,1+time)));
        await db.SaveChangesAsync();

        var results=await LoggedFoods.Matching("oat bar",db,default);

        Assert.Equal(LoggedFoods.MaxRows,results.Count);
        Assert.Equal(["Oat bar 7","Oat bar 6","Oat bar 5","Oat bar 4","Oat bar 3"],results.Select(result=>result.Name));
    }

    [Fact]
    public async Task Logged_foods_still_answer_when_every_provider_is_down()
    {
        await using var db=Db();
        var user=await TestUsers.CreateAsync(db,"offline-providers");
        db.CurrentUser=user.Id;
        db.Entries.Add(Entry(user.Id,"Greek Style Yoghurt · Lactel",YoghurtSource,286,280));
        await db.SaveChangesAsync();
        var down=new FakeFoodProvider("off"){OnSearch=FakeFoodProvider.Fails<IReadOnlyList<FoodResult>>(FoodProviderFailure.Unavailable)};

        var results=await Catalog(down).Search("lactel",db,default);

        Assert.Equal("Greek Style Yoghurt · Lactel",Assert.Single(results).Name);
    }

    [Fact]
    public async Task An_outage_still_surfaces_when_nothing_logged_matches()
    {
        await using var db=Db();
        var user=await TestUsers.CreateAsync(db,"outage-no-match");
        db.CurrentUser=user.Id;
        db.Entries.Add(Entry(user.Id,"Greek Style Yoghurt · Lactel",YoghurtSource,286,280));
        await db.SaveChangesAsync();
        var down=new FakeFoodProvider("off"){OnSearch=FakeFoodProvider.Fails<IReadOnlyList<FoodResult>>(FoodProviderFailure.Unavailable)};

        var outage=await Assert.ThrowsAsync<DomainException>(()=>Catalog(down).Search("sushi",db,default));

        Assert.Equal(503,outage.Status);
    }

    [Fact]
    public async Task A_query_that_is_too_short_is_still_rejected_rather_than_answered_from_the_diary()
    {
        await using var db=Db();
        var user=await TestUsers.CreateAsync(db,"short-query");
        db.CurrentUser=user.Id;
        db.Entries.Add(Entry(user.Id,"A2 milk","manual",60,100));
        await db.SaveChangesAsync();

        var rejected=await Assert.ThrowsAsync<DomainException>(()=>Catalog(new FakeFoodProvider("off")).Search("a",db,default));

        Assert.Equal(400,rejected.Status);
    }
}
