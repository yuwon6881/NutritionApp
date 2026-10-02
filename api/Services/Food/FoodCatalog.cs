using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// The one entry point for food search and barcode lookup. Search fans out to every enabled
/// provider and merges what answered; barcode walks the configured chain and stops at the first
/// hit. Providers stay unaware of each other and of the user-facing error text.
/// </summary>
public sealed class FoodCatalog
{
    // Bump when provider mapping, display filtering, or merging changes so a process does not keep
    // serving rows cached under the old shape.
    private const string SearchCacheVersion="search:v7:";
    private static readonly TimeSpan CompleteSearchLifetime=TimeSpan.FromHours(6);
    // A merge missing a provider is still worth reusing briefly, but not for hours.
    private static readonly TimeSpan PartialSearchLifetime=TimeSpan.FromMinutes(1);
    private static readonly TimeSpan BarcodeLifetime=TimeSpan.FromDays(1);

    private readonly IReadOnlyList<IFoodProvider> searchProviders;
    private readonly IReadOnlyList<IFoodProvider> barcodeProviders;
    private readonly IMemoryCache cache;
    private readonly FoodProviderHealth health;
    private readonly string searchKey;

    public FoodCatalog(IEnumerable<IFoodProvider> providers,IMemoryCache cache,FoodProviderOrder? order=null,FoodProviderHealth? health=null)
    {
        var available=providers.ToArray();
        order??=FoodProviderOrder.Registration(available);
        searchProviders=order.Select(available,order.Search,FoodCapability.Search);
        barcodeProviders=order.Select(available,order.Barcode,FoodCapability.Barcode);
        this.cache=cache;
        this.health=health??new FoodProviderHealth();
        searchKey=SearchCacheVersion+string.Join(',',searchProviders.Select(provider=>provider.Id))+":";
    }

    /// <summary>
    /// How long a merge keeps waiting for the remaining providers once one has returned matches.
    /// Open Food Facts can spend seconds on pacing and hydration while the bundled catalogue answers
    /// at once; a provider that alone has matches is still waited for, up to its own timeout.
    /// </summary>
    public TimeSpan MergeGrace { get; init; }=TimeSpan.FromSeconds(2);

    public IReadOnlyList<IFoodProvider> SearchProviders=>searchProviders;
    public IReadOnlyList<IFoodProvider> BarcodeProviders=>barcodeProviders;

    public Task<IReadOnlyList<FoodResult>> Search(string query,CancellationToken ct)=>SearchShared(query,null,ct);

    /// <summary>Shared provider results, then this account's frequency ordering.</summary>
    public async Task<IReadOnlyList<FoodResult>> Search(string query,AppDb db,CancellationToken ct)
    {
        var results=await SearchShared(query,db,ct);
        return await FoodRanking.RankForUser(results,query.Trim(),db,ct);
    }

    private async Task<IReadOnlyList<FoodResult>> SearchShared(string query,AppDb? db,CancellationToken ct)
    {
        query=query.Trim(); Validation.Require(query.Length is >=2 and <=100,"Enter 2–100 characters.");
        var key=searchKey+query.ToLowerInvariant();
        if(cache.TryGetValue<IReadOnlyList<FoodResult>>(key,out var saved))return saved!;
        using var gate=await ReadGate.Enter(key,ct);
        if(cache.TryGetValue(key,out saved))return saved!;

        var durable=db is null?null:new PublicFoodCache(db);
        var outcomes=await SearchAll(query,durable,ct);
        var answered=outcomes.Where(outcome=>outcome.Failure is null).Select(outcome=>(outcome.Provider,outcome.Results)).ToArray();
        var merged=FoodResultMerger.Merge(answered,query);
        var failed=outcomes.Where(outcome=>outcome.Failure is not null).ToArray();
        // An empty list is only an answer when every provider gave it. Otherwise "no results" would
        // hide an outage, so the person gets the failure and its remedy instead.
        if(merged.Count==0&&failed.Length>0)
        {
            var worst=failed.OrderBy(outcome=>FoodLookupErrors.Precedence(outcome.Failure!.Value)).First();
            throw FoodLookupErrors.Search(worst.Provider.Name,worst.Failure!.Value);
        }
        // Open Food Facts verifies a row's per-100 g basis in a separate, flaky bulk read. A list still
        // holding unverified rows is reused only briefly, so a passing outage does not pin
        // "loads when opened" on that query for hours; verified products come from the durable cache.
        var complete=failed.Length==0&&merged.All(result=>result.Basis!="unverified");
        var lifetime=complete?CompleteSearchLifetime:PartialSearchLifetime;
        cache.Set(key,merged,new MemoryCacheEntryOptions { Size=1,AbsoluteExpirationRelativeToNow=lifetime });
        return merged;
    }

    private sealed record SearchOutcome(IFoodProvider Provider,IReadOnlyList<FoodResult> Results,FoodProviderFailure? Failure);

    private async Task<SearchOutcome[]> SearchAll(string query,PublicFoodCache? durable,CancellationToken ct)
    {
        using var grace=CancellationTokenSource.CreateLinkedTokenSource(ct);
        var searches=searchProviders.Select(provider=>SearchOne(provider,query,durable,ct,grace.Token)).ToArray();
        var pending=searches.ToList();
        var graceStarted=false;
        while(pending.Count>0)
        {
            var finished=await Task.WhenAny(pending);
            pending.Remove(finished);
            if(!graceStarted&&pending.Count>0&&(await finished).Results.Count>0)
            {
                graceStarted=true;
                grace.CancelAfter(MergeGrace);
            }
        }
        return await Task.WhenAll(searches);
    }

    private async Task<SearchOutcome> SearchOne(IFoodProvider provider,string query,PublicFoodCache? durable,CancellationToken ct,CancellationToken grace)
    {
        var breaker=health.Breaker(provider.Id);
        if(breaker.IsOpen)return new SearchOutcome(provider,[],FoodProviderFailure.Unavailable);
        using var deadline=CancellationTokenSource.CreateLinkedTokenSource(grace);
        deadline.CancelAfter(provider.SearchTimeout);
        try
        {
            var results=(await provider.Search(query,durable,deadline.Token))
                .Where(result=>FoodResults.HasOnlyLatinLetters(result.Name))
                .ToArray();
            breaker.Succeeded();
            return new SearchOutcome(provider,results,null);
        }
        catch(FoodProviderException failure)
        {
            Record(breaker,failure);
            return new SearchOutcome(provider,[],failure.Failure);
        }
        catch(OperationCanceledException) when(!ct.IsCancellationRequested)
        {
            // Cut off by the merge grace is not a fault: the provider was working, just slower
            // than a result the person already has. Only its own timeout counts against it.
            if(!grace.IsCancellationRequested)breaker.Failed();
            return new SearchOutcome(provider,[],FoodProviderFailure.TimedOut);
        }
        catch(Exception error) when(error is HttpRequestException or System.Text.Json.JsonException)
        {
            breaker.Failed();
            return new SearchOutcome(provider,[],FoodProviderFailure.Unavailable);
        }
    }

    public async Task<FoodResult> Barcode(string code,AppDb db,CancellationToken ct)
    {
        Validation.Require(code.Length is >=8 and <=14&&code.All(char.IsAsciiDigit),"Enter an 8–14 digit barcode.");
        // The account's own mapping wins over every public source.
        var local=await db.Foods.AsNoTracking().SingleOrDefaultAsync(food=>!food.Deleted&&food.Barcode==code,ct);
        if(local is not null)
        {
            var portions=FoodResults.ParseStoredPortions(local.PortionsJson);
            return new FoodResult(local.Name,local.Calories,local.Protein,local.Fat,local.Carbs,local.Fiber,local.Source,local.ServingGrams,portions,code,FoodResults.ServingCalories(local.Calories,portions),"per100g");
        }
        var key="barcode:"+code;
        if(cache.TryGetValue<FoodResult>(key,out var saved))return saved!;
        using var gate=await ReadGate.Enter(key,ct);
        if(cache.TryGetValue(key,out saved))return saved!;

        var durable=new PublicFoodCache(db);
        if(await durable.ReadBarcode(barcodeProviders.Select(provider=>provider.Id).ToArray(),code,ct) is { } stored)
        {
            cache.Set(key,stored,new MemoryCacheEntryOptions { Size=1,AbsoluteExpirationRelativeToNow=BarcodeLifetime });
            return stored;
        }
        var failures=new List<(IFoodProvider Provider,FoodProviderFailure Failure)>();
        foreach(var provider in barcodeProviders)
        {
            var breaker=health.Breaker(provider.Id);
            if(breaker.IsOpen) { failures.Add((provider,FoodProviderFailure.Unavailable)); continue; }
            FoodResult? found;
            try
            {
                found=await provider.Barcode(code,ct);
                breaker.Succeeded();
            }
            catch(FoodProviderException failure)
            {
                Record(breaker,failure);
                failures.Add((provider,failure.Failure));
                continue;
            }
            if(found is null)continue;
            cache.Set(key,found,new MemoryCacheEntryOptions { Size=1,AbsoluteExpirationRelativeToNow=BarcodeLifetime });
            if(provider.DurableLifetime is { } lifetime)
                await durable.Store(provider.Id,[found],DateTime.UtcNow.Add(lifetime),ct);
            return found;
        }
        if(failures.Count==0)throw FoodLookupErrors.BarcodeNotFound();
        var worst=failures.OrderBy(item=>FoodLookupErrors.Precedence(item.Failure)).First();
        throw FoodLookupErrors.Barcode(worst.Provider.Name,worst.Failure);
    }

    // Pacing and shed answers are already handled by the provider's own gate; the breaker only
    // counts faults, so a busy provider is not also locked out for a minute.
    private static void Record(ProviderBreaker breaker,FoodProviderException failure)
    {
        if(failure.Failure is FoodProviderFailure.Throttled or FoodProviderFailure.Busy or FoodProviderFailure.Incomplete)return;
        breaker.Failed(failure.RetryAfter);
    }
}
