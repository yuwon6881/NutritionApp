using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services.FoodLookup;
using Xunit;
using static Nutrition.Tests.FoodResultsFor;

namespace Nutrition.Tests;

public sealed class FoodCatalogTests : IAsyncLifetime
{
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
    public async Task One_provider_down_still_returns_the_others()
    {
        var down=new FakeFoodProvider("off"){OnSearch=FakeFoodProvider.Fails<IReadOnlyList<FoodResult>>(FoodProviderFailure.Unavailable)};
        var up=new FakeFoodProvider("usda",local:true){OnSearch=_=>[Generic("Bananas, raw")]};

        var results=await Catalog(up,down).Search("banana",default);

        Assert.Equal("Bananas, raw",Assert.Single(results).Name);
    }

    [Theory]
    [InlineData("usda")]
    [InlineData("fatsecret")]
    [InlineData("off")]
    public async Task Public_search_providers_drop_names_with_non_Latin_letters(string providerId)
    {
        var provider=new FakeFoodProvider(providerId)
        {
            OnSearch=_=>[
                Generic("Чёрные оливки без косточек"),
                Generic("Pitted black olives"),
            ],
        };

        var results=await Catalog(provider).Search("olives",default);

        Assert.Equal("Pitted black olives",Assert.Single(results).Name);
    }

    [Theory]
    [InlineData(FoodProviderFailure.Unavailable,503,"temporarily unavailable")]
    [InlineData(FoodProviderFailure.TimedOut,503,"temporarily unavailable")]
    [InlineData(FoodProviderFailure.Busy,429,"busy at Provider off")]
    public async Task Every_provider_failing_reports_the_most_useful_remedy(FoodProviderFailure failure,int status,string message)
    {
        var failing=new FakeFoodProvider("off"){OnSearch=FakeFoodProvider.Fails<IReadOnlyList<FoodResult>>(failure)};
        var empty=new FakeFoodProvider("usda",local:true);

        var error=await Assert.ThrowsAsync<DomainException>(()=>Catalog(empty,failing).Search("banana",default));

        Assert.Equal(status,error.Status);
        Assert.Contains(message,error.Message);
    }

    [Theory]
    [InlineData("unverified",2)]
    [InlineData("per100g",1)]
    public async Task A_list_with_unverified_rows_is_reused_only_briefly(string basis,int expectedCalls)
    {
        var clock=new ManualClock(DateTimeOffset.UtcNow);
        var provider=new FakeFoodProvider("off"){OnSearch=_=>[Branded("Goodday Cultured Milk Drink","9556404123223") with {Basis=basis}]};
        var catalog=new FoodCatalog([provider],new MemoryCache(new MemoryCacheOptions{SizeLimit=256,Clock=clock}));

        await catalog.Search("goodday",default);
        clock.UtcNow=clock.UtcNow.AddMinutes(2);
        await catalog.Search("goodday",default);

        Assert.Equal(expectedCalls,provider.SearchCalls.Count);
    }

#pragma warning disable CS0618 // MemoryCacheOptions still reads time through ISystemClock.
    private sealed class ManualClock(DateTimeOffset now):Microsoft.Extensions.Internal.ISystemClock
    {
        public DateTimeOffset UtcNow { get; set; }=now;
    }
#pragma warning restore CS0618

    [Fact]
    public async Task No_match_anywhere_is_an_empty_answer()
    {
        var results=await Catalog(new FakeFoodProvider("usda"),new FakeFoodProvider("off")).Search("zzzz",default);

        Assert.Empty(results);
    }

    [Fact]
    public async Task A_slow_provider_is_dropped_from_the_merge()
    {
        var slow=new SlowProvider("fatsecret");
        var fast=new FakeFoodProvider("usda"){OnSearch=_=>[Generic("Bananas, raw")]};

        var results=await Catalog(fast,slow).Search("banana",default);

        Assert.Single(results);
    }

    [Fact]
    public async Task A_repeated_search_is_answered_from_memory()
    {
        var provider=new FakeFoodProvider("usda"){OnSearch=_=>[Generic("Bananas, raw")]};
        var catalog=Catalog(provider);

        await catalog.Search("Banana",default);
        await catalog.Search("banana ",default);

        Assert.Single(provider.SearchCalls);
    }

    [Fact]
    public async Task Barcode_walks_the_chain_in_order_and_stops_at_the_first_hit()
    {
        var first=new FakeFoodProvider("off");
        var second=new FakeFoodProvider("fatsecret"){OnBarcode=code=>Branded("Milo · Nestlé",code)};
        var third=new FakeFoodProvider("usda-branded"){OnBarcode=code=>Branded("Other",code)};
        await using var db=Db();

        var result=await Catalog(first,second,third).Barcode("9556001000000",db,default);

        Assert.Equal("Milo · Nestlé",result.Name);
        Assert.Single(first.BarcodeCalls);
        Assert.Empty(third.BarcodeCalls);
    }

    [Fact]
    public async Task Barcode_keeps_the_original_non_Latin_package_name_for_review()
    {
        var provider=new FakeFoodProvider("off")
        {
            OnBarcode=code=>Branded("Чёрные оливки · Goodday",code),
        };
        await using var db=Db();

        var result=await Catalog(provider).Barcode("9556001000000",db,default);

        Assert.Equal("Чёрные оливки · Goodday",result.Name);
    }

    [Fact]
    public async Task Barcode_is_not_found_only_when_every_provider_says_so()
    {
        await using var db=Db();

        var error=await Assert.ThrowsAsync<DomainException>(()=>Catalog(new FakeFoodProvider("off"),new FakeFoodProvider("fatsecret")).Barcode("9556001000000",db,default));

        Assert.Equal(404,error.Status);
    }

    [Fact]
    public async Task Barcode_outage_without_a_hit_keeps_retry_available()
    {
        var incomplete=new FakeFoodProvider("off"){OnBarcode=FakeFoodProvider.Fails<FoodResult?>(FoodProviderFailure.Incomplete)};
        var down=new FakeFoodProvider("fatsecret"){OnBarcode=FakeFoodProvider.Fails<FoodResult?>(FoodProviderFailure.Unreachable)};
        await using var db=Db();

        var error=await Assert.ThrowsAsync<DomainException>(()=>Catalog(incomplete,down).Barcode("9556001000000",db,default));

        Assert.Equal(503,error.Status);
    }

    [Fact]
    public async Task Barcode_with_only_incomplete_data_asks_for_a_label_scan()
    {
        var incomplete=new FakeFoodProvider("off"){OnBarcode=FakeFoodProvider.Fails<FoodResult?>(FoodProviderFailure.Incomplete)};
        await using var db=Db();

        var error=await Assert.ThrowsAsync<DomainException>(()=>Catalog(incomplete,new FakeFoodProvider("fatsecret")).Barcode("9556001000000",db,default));

        Assert.Equal(422,error.Status);
    }

    [Fact]
    public async Task A_durable_barcode_row_short_circuits_every_provider()
    {
        var provider=new FakeFoodProvider("off"){DurableLifetime=TimeSpan.FromDays(1),OnBarcode=code=>Branded("Milo · Nestlé",code)};
        await using(var db=Db())await Catalog(provider).Barcode("9556001000000",db,default);
        var later=new FakeFoodProvider("off"){DurableLifetime=TimeSpan.FromDays(1)};

        await using var reader=Db();
        var result=await Catalog(later).Barcode("9556001000000",reader,default);

        Assert.Equal("Milo · Nestlé",result.Name);
        Assert.Empty(later.BarcodeCalls);
    }

    [Fact]
    public async Task A_provider_without_durable_permission_is_never_stored()
    {
        var provider=new FakeFoodProvider("fatsecret"){OnBarcode=code=>Branded("Milo · Nestlé",code)};
        await using var db=Db();

        await Catalog(provider).Barcode("9556001000000",db,default);

        Assert.Empty(await db.PublicFoodProducts.ToListAsync());
    }

    [Fact]
    public async Task A_search_only_provider_is_not_asked_for_barcodes()
    {
        var searchOnly=new FakeFoodProvider("usda",FoodCapability.Search);
        await using var db=Db();

        await Assert.ThrowsAsync<DomainException>(()=>Catalog(searchOnly).Barcode("9556001000000",db,default));

        Assert.Empty(searchOnly.BarcodeCalls);
    }

    [Fact]
    public void Configured_order_skips_unregistered_providers()
    {
        var off=new FakeFoodProvider("off");
        var usda=new FakeFoodProvider("usda",FoodCapability.Search);
        var order=new FoodProviderOrder(["usda","fatsecret","off"],["off","fatsecret","usda-branded"]);

        var catalog=new FoodCatalog([off,usda],new MemoryCache(new MemoryCacheOptions{SizeLimit=256}),order);

        Assert.Equal(["usda","off"],catalog.SearchProviders.Select(provider=>provider.Id));
        Assert.Equal(["off"],catalog.BarcodeProviders.Select(provider=>provider.Id));
    }

    [Fact]
    public async Task A_slow_provider_is_cut_off_once_another_has_answered_without_counting_as_a_fault()
    {
        var health=new FoodProviderHealth();
        var slow=new SlowProvider("off",delay:TimeSpan.FromSeconds(10),timeout:TimeSpan.FromSeconds(30));
        var fast=new FakeFoodProvider("usda"){OnSearch=query=>[Generic("Bananas, raw "+query)]};
        var catalog=new FoodCatalog([fast,slow],new MemoryCache(new MemoryCacheOptions{SizeLimit=256}),health:health){MergeGrace=TimeSpan.FromMilliseconds(100)};
        var watch=System.Diagnostics.Stopwatch.StartNew();

        foreach(var query in new[]{"banana","bananas","banana raw"})
            Assert.Single(await catalog.Search(query,default));

        Assert.True(watch.Elapsed<TimeSpan.FromSeconds(5),$"Search waited {watch.Elapsed} for the slow provider.");
        Assert.False(health.Breaker("off").IsOpen);
    }

    [Fact]
    public async Task A_provider_that_alone_has_matches_is_waited_for()
    {
        var slow=new SlowProvider("off",delay:TimeSpan.FromMilliseconds(300),timeout:TimeSpan.FromSeconds(30));
        var empty=new FakeFoodProvider("usda");
        var catalog=new FoodCatalog([empty,slow],new MemoryCache(new MemoryCacheOptions{SizeLimit=256})){MergeGrace=TimeSpan.FromMilliseconds(20)};

        Assert.Equal("Milo · Nestlé",Assert.Single(await catalog.Search("milo",default)).Name);
    }

    private sealed class SlowProvider(string id,TimeSpan? delay=null,TimeSpan? timeout=null):IFoodProvider
    {
        public string Id=>id;
        public string Name=>id;
        public FoodCapability Capabilities=>FoodCapability.Search;
        public TimeSpan SearchTimeout=>timeout??TimeSpan.FromMilliseconds(50);
        public async Task<IReadOnlyList<FoodResult>> Search(string query,PublicFoodCache? durable,CancellationToken ct)
        {
            await Task.Delay(delay??TimeSpan.FromSeconds(10),ct);
            return [Branded("Milo · Nestlé","9556001000000")];
        }
        public Task<FoodResult?> Barcode(string code,CancellationToken ct)=>Task.FromResult<FoodResult?>(null);
    }
}
