using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Nutrition.Api.Services.FoodLookup;
using Xunit;

namespace Nutrition.Tests;

public sealed class FoodBarcodeTests : IAsyncLifetime
{
    private readonly string path=Path.Combine(Path.GetTempPath(),$"nutrition-barcode-{Guid.NewGuid()}.db");
    private AppDb Open(Guid? user=null)=>new(new DbContextOptionsBuilder<AppDb>().UseSqlite($"Data Source={path}").Options){CurrentUser=user};

    public async Task InitializeAsync(){await using var db=Open();await db.Database.EnsureCreatedAsync();}
    public Task DisposeAsync(){Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();File.Delete(path);return Task.CompletedTask;}

    private sealed class FailHandler:HttpMessageHandler
    {
        public int Calls{get;private set;}
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound){Content=new StringContent("{}")});
        }
    }

    [Fact]
    public async Task A_cached_product_saved_before_results_had_a_measure_is_refetched_not_read_as_grams()
    {
        await using var db=Open();
        var cache=new PublicFoodCache(db);
        var stored=new FoodResult("HL Milk",50,3,1,6,null,"Open Food Facts / ODbL / 8888026520014",Code:"8888026520014",Measure:"ml");
        await cache.Store(OpenFoodFactsProvider.ProviderId,[stored],DateTime.UtcNow.AddDays(1),default);

        Assert.Equal("ml",(await cache.ReadBarcode([OpenFoodFactsProvider.ProviderId],"8888026520014",default))!.Measure);

        var row=await db.PublicFoodProducts.SingleAsync();
        row.ResultJson=row.ResultJson.Replace(",\"measure\":\"ml\"","",StringComparison.Ordinal);
        Assert.DoesNotContain("measure",row.ResultJson,StringComparison.Ordinal);
        await db.SaveChangesAsync();

        Assert.Null(await cache.ReadBarcode([OpenFoodFactsProvider.ProviderId],"8888026520014",default));
    }

    [Fact]
    public async Task Account_food_barcode_is_resolved_before_open_food_facts()
    {
        var user=Guid.NewGuid();
        await using(var seed=Open())
        {
            seed.Users.Add(new AppUser{Id=user,DisplayName="barcode-local",IdentitySubject="sub_local"});
            await seed.SaveChangesAsync();
        }
        await using(var seed=Open(user))
        {
            seed.Foods.Add(new Food{Id=Guid.NewGuid(),UserId=user,Name="Private tuna",Calories=180,Protein=25,Barcode="9551234567890",PortionsJson="[{\"label\":\"can\",\"grams\":185}]"});
            await seed.SaveChangesAsync();
        }

        var handler=new FailHandler();
        var service=new FoodCatalog([new OpenFoodFactsProvider(new HttpClient(handler))],new MemoryCache(new MemoryCacheOptions{SizeLimit=256}));
        await using var db=Open(user);
        var result=await service.Barcode("9551234567890",db,default);

        Assert.Equal("Private tuna",result.Name);
        Assert.Equal("9551234567890",result.Code);
        Assert.Equal(185,Assert.Single(result.Portions!).Grams);
        Assert.Equal(0,handler.Calls);
    }

    private sealed class ProductHandler:HttpMessageHandler
    {
        public int Calls{get;private set;}
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken)
        {
            Calls++;
            var code=request.RequestUri!.AbsolutePath.Split('/').Last().Replace(".json","");
            var body="""{"status":1,"product":{"code":"CODE","product_name":"Biscuit CODE","nutriments":{"energy-kcal_100g":480}}}""".Replace("CODE",code);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(body)});
        }
    }

    private sealed class FixedProductHandler(string body):HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken)
            =>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(body)});
    }

    [Fact]
    public async Task A_scanned_drink_whose_unit_field_says_grams_but_whose_label_says_millilitres_is_per_100_ml_end_to_end()
    {
        // The record behind "HL MILK · Marigold": a 200 ml serving label beside a unit field left at g.
        const string product="""
            {"status":1,"product":{"code":"8888026520014","product_name":"HL MILK","brands":"Marigold",
             "serving_size":"1 serving (200 ml)","serving_quantity":200,"serving_quantity_unit":"g",
             "nutriments":{"energy-kcal_100g":50,"proteins_100g":4.2,"carbohydrates_100g":6.3,"fat_100g":0.9}}}
            """;
        var service=new FoodCatalog([new OpenFoodFactsProvider(new HttpClient(new FixedProductHandler(product)))],new MemoryCache(new MemoryCacheOptions{SizeLimit=256}));
        await using var db=Open();

        var result=await service.Barcode("8888026520014",db,default);

        Assert.Equal("ml",result.Measure);
        Assert.Equal("per100g",result.Basis);
        var portion=Assert.Single(result.Portions!);
        Assert.Equal("1 serving (200 ml)",portion.Label);
        Assert.Equal(200,portion.Grams);
        // It reaches the client as JSON with the measure present.
        Assert.Equal("ml",JsonDocument.Parse(Json.Write(result)).RootElement.GetProperty("measure").GetString());
    }

    [Fact]
    public async Task Scanning_another_uncached_barcode_waits_for_its_slot_instead_of_failing()
    {
        var handler=new ProductHandler();
        var provider=new OpenFoodFactsProvider(new HttpClient(handler));
        var first=await provider.Barcode("9551234560011",default);
        // A second package scanned straight after the first is paced behind it, not answered with a 429.
        var started=DateTime.UtcNow;
        var second=await provider.Barcode("9551234560028",default);
        Assert.Equal("9551234560011",first!.Code);
        Assert.Equal("9551234560028",second!.Code);
        Assert.Equal(2,handler.Calls);
        Assert.InRange(DateTime.UtcNow-started,TimeSpan.FromSeconds(2),TimeSpan.FromSeconds(8));
    }

    [Fact]
    public async Task Food_barcode_updates_preserve_omitted_legacy_fields_and_reject_duplicates()
    {
        var user=Guid.NewGuid();
        await using(var seed=Open())
        {
            seed.Users.Add(new AppUser{Id=user,DisplayName="barcode-sync",IdentitySubject="sub_sync"});
            await seed.SaveChangesAsync();
        }
        async Task<long> Apply(Guid id,long revision,object data)
        {
            await using var db=Open(user);
            return await new SyncService(db).Apply(new Mutation(Guid.NewGuid(),"food",id,revision,JsonSerializer.SerializeToElement(data)),default);
        }

        var first=Guid.NewGuid();
        var revision=await Apply(first,0,new{name="Tuna",calories=180,servingGrams=100,barcode="9551234567890"});
        revision=await Apply(first,revision,new{name="Tuna updated",calories=190,servingGrams=100});
        await using(var verify=Open(user))Assert.Equal("9551234567890",(await verify.Foods.SingleAsync()).Barcode);

        var duplicate=await Assert.ThrowsAsync<DomainException>(()=>Apply(Guid.NewGuid(),0,new{name="Other",calories=100,servingGrams=100,barcode="9551234567890"}));
        Assert.Equal(409,duplicate.Status);
        var invalid=await Assert.ThrowsAsync<DomainException>(()=>Apply(Guid.NewGuid(),0,new{name="Invalid",calories=100,servingGrams=100,barcode="1234"}));
        Assert.Equal(400,invalid.Status);
    }
}
