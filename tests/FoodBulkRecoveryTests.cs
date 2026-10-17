using System.Net;
using System.Net.Http.Headers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Nutrition.Api.Data;
using Nutrition.Api.Services.FoodLookup;
using Xunit;

namespace Nutrition.Tests;

/// <summary>
/// When Open Food Facts refuses the bulk product read, the confirming read recovers through the
/// per-product endpoint, the refusal is logged with its status, and a search never pays for it.
/// </summary>
public sealed class FoodBulkRecoveryTests : IAsyncLifetime
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

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    public async Task A_refused_bulk_read_is_logged_and_the_row_is_confirmed_from_the_product_endpoint(HttpStatusCode refusal)
    {
        var handler=new RoutingHandler(refusal);
        var log=new ListLogger();
        await using var db=Db();
        var durable=new PublicFoodCache(db);

        var verified=await new OpenFoodFactsProvider(new HttpClient(handler),log,new OpenFoodFactsPacing()).VerifyBasis(["9557337800106"],durable,default);

        var product=Assert.Single(verified);
        Assert.Equal("per100g",product.Basis);
        Assert.Equal(88,product.Calories);
        Assert.Equal(1,handler.ProductReads);
        Assert.Contains(log.Messages,message=>message.Contains($"HTTP {(int)refusal}",StringComparison.Ordinal));
        // The confirmed row is now durable, so the next list shows it without another call.
        Assert.Single(await durable.Read(OpenFoodFactsProvider.ProviderId,["9557337800106"],default));
    }

    [Fact]
    public async Task The_per_product_fallback_stops_at_the_first_refusal()
    {
        var handler=new RoutingHandler(HttpStatusCode.ServiceUnavailable){ProductStatus=HttpStatusCode.TooManyRequests};
        await using var db=Db();

        var verified=await new OpenFoodFactsProvider(new HttpClient(handler),null,new OpenFoodFactsPacing()).VerifyBasis(["9557337800106","9557337800090","0819393021062"],new PublicFoodCache(db),default);

        Assert.Empty(verified);
        Assert.Equal(1,handler.ProductReads);
    }

    [Fact]
    public async Task A_search_whose_bulk_read_is_refused_keeps_its_rows_unverified_without_product_reads()
    {
        var handler=new RoutingHandler(HttpStatusCode.ServiceUnavailable);

        var results=await new OpenFoodFactsProvider(new HttpClient(handler),null,new OpenFoodFactsPacing()).Search("sunglo yogurt",null,default);

        var row=Assert.Single(results);
        Assert.Equal("unverified",row.Basis);
        Assert.Equal(0,handler.ProductReads);
    }

    [Fact]
    public async Task The_confirming_read_skips_a_bulk_read_that_just_failed()
    {
        var handler=new RoutingHandler(HttpStatusCode.ServiceUnavailable);
        var provider=new OpenFoodFactsProvider(new HttpClient(handler),null,new OpenFoodFactsPacing());
        await using var db=Db();

        // The search's own bulk read fails; the confirming read then goes straight to the product
        // endpoint instead of waiting for another slot to fail the same way.
        var row=Assert.Single(await provider.Search("sunglo yogurt",null,default));
        var verified=await provider.VerifyBasis([row.Code!],new PublicFoodCache(db),default);

        Assert.Equal(1,handler.BulkReads);
        Assert.Equal(1,handler.ProductReads);
        Assert.Equal("per100g",Assert.Single(verified).Basis);
    }

    [Fact]
    public async Task Opening_a_row_is_not_refused_while_the_fallback_confirms_others()
    {
        var handler=new RoutingHandler(HttpStatusCode.ServiceUnavailable);
        var provider=new OpenFoodFactsProvider(new HttpClient(handler),null,new OpenFoodFactsPacing());
        await using var db=Db();

        var verifying=provider.VerifyBasis(["9557337800106","9557337800090","0819393021062"],new PublicFoodCache(db),default);
        await handler.FirstProductRead.Task;
        // The fallback moves on to its next row while the person opens another one. Background
        // confirmation must not queue ahead of them: production refused this tap with a 429.
        await Task.Delay(200);
        var opened=await provider.Barcode("9300633603137",default);

        Assert.Equal("per100g",opened!.Basis);
        Assert.Equal(3,(await verifying).Count);
    }

    [Fact]
    public async Task An_idle_slot_never_queues_ahead_of_a_later_caller()
    {
        var gate=new ProviderGate();
        var interval=TimeSpan.FromMilliseconds(400);
        await gate.ReserveWhenIdle(interval,default);
        var background=gate.ReserveWhenIdle(interval,default);

        // The waiting background read holds nothing, so a person's read waits one interval, not two.
        var person=(await gate.Reserve(interval,null,default))!.Value;
        await background;

        Assert.True(person.Wait<=interval,$"waited {person.Wait}");
    }

    [Fact]
    public void A_bulk_failure_is_remembered_until_a_bulk_read_succeeds()
    {
        var pacing=new OpenFoodFactsPacing();
        Assert.False(pacing.BulkRecentlyFailed);

        pacing.NoteBulkFailure();
        Assert.True(pacing.BulkRecentlyFailed);

        pacing.NoteBulkSuccess();
        Assert.False(pacing.BulkRecentlyFailed);
    }

    [Fact]
    public async Task A_bulk_read_cancelled_while_it_waits_hands_its_slot_back()
    {
        var pacing=new OpenFoodFactsPacing();
        // Another request already holds the next slot, so the read below has to wait about six seconds.
        await pacing.BatchProduct.Reserve(TimeSpan.FromSeconds(6.1),null,default);
        var handler=new RoutingHandler(HttpStatusCode.OK);
        await using var db=Db();
        using var cancel=new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>
            new OpenFoodFactsProvider(new HttpClient(handler),null,pacing).VerifyBasis(["9557337800106"],new PublicFoodCache(db),cancel.Token));

        // Had the cancelled read kept its slot, the next one would wait roughly twelve seconds.
        var next=(await pacing.BatchProduct.Reserve(TimeSpan.FromSeconds(6.1),null,default))!.Value;
        Assert.True(next.Wait<TimeSpan.FromSeconds(7),$"waited {next.Wait}");
        Assert.Equal(0,handler.ProductReads);
    }

    private sealed class RoutingHandler(HttpStatusCode bulkStatus):HttpMessageHandler
    {
        public HttpStatusCode ProductStatus { get; init; }=HttpStatusCode.OK;
        public int ProductReads { get; private set; }
        public int BulkReads { get; private set; }
        public TaskCompletionSource FirstProductRead { get; }=new(TaskCreationOptions.RunContinuationsAsynchronously);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {
            var url=request.RequestUri!;
            if(url.Host=="search.openfoodfacts.org")return Json("""{"hits":[{"code":"9557337800106","product_name":"Greek Yoghurt","brands":["Sunglo"],"nutriments":{"energy-kcal_100g":80}}]}""");
            if(url.AbsolutePath=="/api/v2/search")
            {
                BulkReads++;
                var response=new HttpResponseMessage(bulkStatus);
                if(bulkStatus==HttpStatusCode.TooManyRequests)response.Headers.RetryAfter=new RetryConditionHeaderValue(TimeSpan.FromSeconds(1));
                return Task.FromResult(response);
            }
            ProductReads++;
            FirstProductRead.TrySetResult();
            return ProductStatus==HttpStatusCode.OK
                ?Json("""{"product":{"code":"CODE","product_name":"Greek Yoghurt","brands":"Sunglo","nutriments":{"energy-kcal_100g":88,"proteins_100g":4,"fat_100g":5,"carbohydrates_100g":6}}}""".Replace("CODE",url.Segments[^1],StringComparison.Ordinal))
                :Task.FromResult(new HttpResponseMessage(ProductStatus));
        }

        private static Task<HttpResponseMessage> Json(string body)
            =>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(body)});
    }

    private sealed class ListLogger:ILogger<OpenFoodFactsProvider>
    {
        public List<string> Messages { get; }=[];
        public IDisposable? BeginScope<TState>(TState state) where TState:notnull=>null;
        public bool IsEnabled(LogLevel logLevel)=>true;
        public void Log<TState>(LogLevel logLevel,EventId eventId,TState state,Exception? exception,Func<TState,Exception?,string> formatter)
            =>Messages.Add(formatter(state,exception));
    }
}
