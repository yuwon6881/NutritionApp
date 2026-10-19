using System.Net;
using System.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Services.FoodLookup;
using Xunit;
using static Nutrition.Tests.FoodResultsFor;

namespace Nutrition.Tests;

/// <summary>
/// A product hidden behind a heavily scanned brand family is reached with a brand-scoped follow-up,
/// and foods the account has already logged come back first when searched for again.
/// </summary>
public sealed class FoodSearchLoggedFoodsTests : IAsyncLifetime
{
    private const string Yoghurt="9300633603526";
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

    [Fact]
    public void A_brand_follow_up_asks_for_the_other_words_inside_the_named_brand()
    {
        IReadOnlyList<FoodResult> hits=[Branded("Lactel bio · Lactel","3428274200259"),Branded("Tuna greek","5204458013048")];

        var followUp=OpenFoodFactsQuery.BrandFollowUp("Lactel Greek",hits,["Lactel","Mare"]);

        Assert.Equal("brands:\"lactel\" AND greek",followUp);
    }

    [Theory]
    [InlineData("lactel")]
    [InlineData("greek yoghurt")]
    public void No_follow_up_for_one_word_or_a_query_naming_no_brand_on_the_page(string query)
        =>Assert.Null(OpenFoodFactsQuery.BrandFollowUp(query,[Branded("Lactel bio · Lactel","3428274200259")],["Lactel"]));

    [Fact]
    public void No_follow_up_when_the_first_page_already_names_every_word()
        =>Assert.Null(OpenFoodFactsQuery.BrandFollowUp("lactel greek",[Branded("Greek Style Yoghurt · Lactel",Yoghurt)],["Lactel"]));

    [Fact]
    public async Task Open_food_facts_search_reads_a_wide_page_and_finds_the_product_behind_its_brand()
    {
        var handler=new SearchHandler();
        await using var db=Db();

        var results=await new OpenFoodFactsProvider(new HttpClient(handler),null,new OpenFoodFactsPacing())
            .Search("lactel greek",new PublicFoodCache(db),default);

        Assert.Equal("50",HttpUtility.ParseQueryString(handler.Queries[0].Query)["page_size"]);
        Assert.Equal("brands:\"lactel\" AND greek",HttpUtility.ParseQueryString(handler.Queries[1].Query)["q"]);
        Assert.Equal("Greek Style Yoghurt · Lactel",results[0].Name);
        Assert.Equal("per100g",results[0].Basis);
    }

    [Fact]
    public void A_logged_entry_rebuilds_per_100_values_from_its_weighed_amount()
    {
        var entry=new DiaryEntry {Name="Greek Style Yoghurt · Lactel",Source="Open Food Facts / ODbL / "+Yoghurt,Calories=286,Protein=14,Carbs=23.8,Fat=14.8,Quantity=280,Unit="g"};

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
    public async Task A_logged_food_the_provider_omits_is_added_first_and_only_for_its_account()
    {
        await using var db=Db();
        var alice=await TestUsers.CreateAsync(db,"alice");
        var bob=await TestUsers.CreateAsync(db,"bob");
        db.MaintenanceAccess=true;
        db.Entries.AddRange(
            new DiaryEntry {Id=Guid.NewGuid(),UserId=alice.Id,Name="Greek Style Yoghurt · Lactel",Source="Open Food Facts / ODbL / "+Yoghurt,Calories=286,Quantity=280,Unit="g",Date=new DateOnly(2026,10,19)},
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
        db.Entries.Add(new DiaryEntry {Id=Guid.NewGuid(),UserId=user.Id,Name="Greek Yoghurt · Lactel",Source="Open Food Facts / ODbL / "+Yoghurt,Calories=100,Quantity=100,Unit="g"});
        await db.SaveChangesAsync();
        var provider=new FakeFoodProvider("off"){OnSearch=_=>[Branded("Greek yoghurt plain","1234567890128"),Branded("Greek Style Yoghurt · Lactel",Yoghurt)]};

        var results=await Catalog(provider).Search("greek yoghurt",db,default);

        Assert.Equal("Greek Yoghurt · Lactel",results[0].Name);
        Assert.Equal(2,results.Count);
    }

    [Fact]
    public async Task Logged_foods_still_answer_when_every_provider_is_down()
    {
        await using var db=Db();
        var user=await TestUsers.CreateAsync(db,"offline-providers");
        db.CurrentUser=user.Id;
        db.Entries.Add(new DiaryEntry {Id=Guid.NewGuid(),UserId=user.Id,Name="Greek Style Yoghurt · Lactel",Source="Open Food Facts / ODbL / "+Yoghurt,Calories=286,Quantity=280,Unit="g"});
        await db.SaveChangesAsync();
        var down=new FakeFoodProvider("off"){OnSearch=FakeFoodProvider.Fails<IReadOnlyList<FoodResult>>(FoodProviderFailure.Unavailable)};

        var results=await Catalog(down).Search("lactel",db,default);

        Assert.Equal("Greek Style Yoghurt · Lactel",Assert.Single(results).Name);
    }

    /// <summary>
    /// The first page holds only the brand's milks and a loose match; the brand-scoped follow-up
    /// holds the yoghurt. Bulk reads answer every requested code.
    /// </summary>
    private sealed class SearchHandler:HttpMessageHandler
    {
        public List<Uri> Queries { get; }=[];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {
            var url=request.RequestUri!;
            if(url.Host=="search.openfoodfacts.org")
            {
                Queries.Add(url);
                var q=HttpUtility.ParseQueryString(url.Query)["q"]!;
                return Json(q.StartsWith("brands:",StringComparison.Ordinal)
                    ?$$$"""{"hits":[{"code":"{{{Yoghurt}}}","product_name":"Greek Style Yoghurt","brands":["Lactel"],"nutriments":{"energy-kcal_100g":102}}]}"""
                    :"""{"hits":[{"code":"3428274200259","product_name":"Lactel bio","brands":["Lactel"],"nutriments":{"energy-kcal_100g":46}},{"code":"5204458013048","product_name":"Tuna greek","brands":["Mare"],"nutriments":{"energy-kcal_100g":178}}]}""");
            }
            var codes=HttpUtility.ParseQueryString(url.Query)["code"]!.Split(',');
            var products=string.Join(',',codes.Select(code=>$$$"""{"code":"{{{code}}}","product_name":"Product","nutriments":{"energy-kcal_100g":100}}"""));
            return Json($$"""{"products":[{{products}}]}""");
        }

        private static Task<HttpResponseMessage> Json(string body)
            =>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(body)});
    }
}
