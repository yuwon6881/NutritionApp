using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services.FoodLookup;
using Xunit;
using static Nutrition.Tests.FoodResultsFor;

namespace Nutrition.Tests;

/// <summary>
/// Search rows Open Food Facts returned before their per-100 g basis was confirmed are confirmed
/// afterwards, so the list can show their nutrition instead of "loads when opened".
/// </summary>
public sealed class FoodBasisVerifyTests : IAsyncLifetime
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

    private static FoodCatalog Catalog(TimeSpan? timeout=null,params IFoodProvider[] providers)
        =>new(providers,new MemoryCache(new MemoryCacheOptions{SizeLimit=256})){VerifyTimeout=timeout??TimeSpan.FromSeconds(20)};

    [Fact]
    public async Task Only_the_provider_that_produced_the_rows_confirms_them()
    {
        var off=new VerifyingProvider("off"){OnVerify=codes=>[..codes.Select(code=>Branded("Milk "+code,code,64) with {Basis="per100g"})]};
        var other=new VerifyingProvider("other"){OnVerify=_=>throw new InvalidOperationException("not asked")};
        await using var db=Db();

        var verified=await Catalog(null,other,off).VerifyBasis("off",["9556404123223","9556404123223","1234567890123"],db,default);

        Assert.Equal(["9556404123223","1234567890123"],off.Calls.Single());
        Assert.All(verified,product=>Assert.Equal("per100g",product.Basis));
        Assert.Empty(await Catalog(null,off).VerifyBasis("usda",["9556404123223"],db,default));
    }

    [Theory]
    [InlineData("")]
    [InlineData("12ab5678")]
    [InlineData("1234567")]
    public async Task Malformed_codes_are_refused(string code)
    {
        await using var db=Db();
        await Assert.ThrowsAsync<DomainException>(()=>Catalog(null,new VerifyingProvider("off")).VerifyBasis("off",code.Length==0?[]:[code],db,default));
    }

    [Fact]
    public async Task Too_many_codes_are_refused()
    {
        await using var db=Db();
        var codes=Enumerable.Range(0,FoodCatalog.MaxVerifyCodes+1).Select(index=>(10_000_000_000L+index).ToString()).ToArray();
        await Assert.ThrowsAsync<DomainException>(()=>Catalog(null,new VerifyingProvider("off")).VerifyBasis("off",codes,db,default));
    }

    [Fact]
    public async Task A_confirming_read_that_overruns_leaves_the_rows_as_they_were()
    {
        var slow=new VerifyingProvider("off"){Delay=TimeSpan.FromSeconds(30)};
        await using var db=Db();

        var verified=await Catalog(TimeSpan.FromMilliseconds(50),slow).VerifyBasis("off",["9556404123223"],db,default);

        Assert.Empty(verified);
    }

    [Fact]
    public async Task Open_Food_Facts_answers_confirmed_products_from_the_durable_cache_without_a_call()
    {
        await using var db=Db();
        var cache=new PublicFoodCache(db);
        var stored=Branded("Goodday Cultured Milk Drink","9556404123223",64) with {Basis="per100g"};
        await cache.Store(OpenFoodFactsProvider.ProviderId,[stored],DateTime.UtcNow.AddDays(1),default);
        var handler=new RefusingHandler();

        var verified=await new OpenFoodFactsProvider(new HttpClient(handler)).VerifyBasis(["9556404123223"],cache,default);

        Assert.Equal(64,Assert.Single(verified).Calories);
        Assert.Equal(0,handler.Calls);
    }

    private sealed class VerifyingProvider(string id):IFoodProvider,IFoodBasisVerifier
    {
        public string Id=>id;
        public string Name=>"Provider "+id;
        public FoodCapability Capabilities=>FoodCapability.Search;
        public TimeSpan Delay { get; init; }=TimeSpan.Zero;
        public Func<IReadOnlyCollection<string>,IReadOnlyList<FoodResult>> OnVerify { get; init; }=_=>[];
        public List<string[]> Calls { get; }=[];

        public Task<IReadOnlyList<FoodResult>> Search(string query,PublicFoodCache? durable,CancellationToken ct)=>Task.FromResult<IReadOnlyList<FoodResult>>([]);
        public Task<FoodResult?> Barcode(string code,CancellationToken ct)=>Task.FromResult<FoodResult?>(null);

        public async Task<IReadOnlyList<FoodResult>> VerifyBasis(IReadOnlyCollection<string> codes,PublicFoodCache durable,CancellationToken ct)
        {
            Calls.Add([..codes]);
            if(Delay>TimeSpan.Zero)await Task.Delay(Delay,ct);
            return OnVerify(codes);
        }
    }

    private sealed class RefusingHandler:HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        }
    }
}
