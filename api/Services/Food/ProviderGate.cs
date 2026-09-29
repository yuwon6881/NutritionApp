namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Paces calls to one provider endpoint. Every request here leaves from the one Cloud Run egress
/// address, so pacing is process-wide: providers hold their gates in static fields.
/// </summary>
public sealed class ProviderGate
{
    public readonly record struct Slot(DateTime Claimed,DateTime Released,TimeSpan Wait);

    private readonly SemaphoreSlim sync=new(1);
    private DateTime next=DateTime.MinValue;

    /// <summary>
    /// Queues a call behind earlier ones. A request that arrives early waits for its slot instead of
    /// failing; only a queue deeper than <paramref name="maxWait"/> is refused (null never refuses).
    /// </summary>
    public async Task<Slot?> Reserve(TimeSpan interval,TimeSpan? maxWait,CancellationToken ct)
    {
        await sync.WaitAsync(ct);
        try
        {
            var now=DateTime.UtcNow;
            var start=next>now?next:now;
            var wait=start-now;
            if(maxWait is { } limit&&wait>limit)return null;
            var released=next;
            next=start.Add(interval);
            return new Slot(next,released,wait);
        }
        finally { sync.Release(); }
    }

    /// <summary>
    /// Hands a failed call's slot back so the retry its error asks for is not answered by our own
    /// limit, but only while no later call has claimed one. Not cancellable for the same reason.
    /// </summary>
    public async Task Return(Slot slot)
    {
        await sync.WaitAsync(CancellationToken.None);
        try { if(next==slot.Claimed)next=slot.Released; }
        finally { sync.Release(); }
    }

    /// <summary>Pushes the next slot out after the provider asked us to back off.</summary>
    public async Task Hold(DateTime until)
    {
        await sync.WaitAsync(CancellationToken.None);
        try { if(until>next)next=until; }
        finally { sync.Release(); }
    }

    /// <summary>Claims a slot only when one is free now; metered calls never queue.</summary>
    public async Task<bool> TryClaim(TimeSpan interval,CancellationToken ct)
    {
        await sync.WaitAsync(ct);
        try
        {
            var now=DateTime.UtcNow;
            if(now<next)return false;
            next=now.Add(interval);
            return true;
        }
        finally { sync.Release(); }
    }
}

/// <summary>
/// Stops calling a provider that keeps failing, so one outage does not add its timeout to every
/// search. After the open period one call is let through to probe for recovery.
/// </summary>
public sealed class ProviderBreaker(int threshold=3,double openSeconds=60)
{
    private readonly object sync=new();
    private int failures;
    private DateTime openUntil=DateTime.MinValue;

    public bool IsOpen { get { lock(sync) return DateTime.UtcNow<openUntil; } }

    public void Succeeded() { lock(sync) { failures=0; openUntil=DateTime.MinValue; } }

    public void Failed(TimeSpan? retryAfter=null)
    {
        lock(sync)
        {
            failures++;
            var now=DateTime.UtcNow;
            if(retryAfter is { } wait&&now.Add(wait)>openUntil)openUntil=now.Add(wait);
            if(failures>=threshold)openUntil=now.AddSeconds(openSeconds);
        }
    }
}

/// <summary>Counts calls against a provider's daily allowance, resetting at midnight UTC.</summary>
public sealed class DailyQuota(int limit)
{
    private readonly object sync=new();
    private DateOnly day;
    private int used;

    public bool TryTake()
    {
        lock(sync)
        {
            var today=DateOnly.FromDateTime(DateTime.UtcNow);
            if(today!=day) { day=today; used=0; }
            if(used>=limit)return false;
            used++;
            return true;
        }
    }

    public static TimeSpan UntilReset()=>DateTime.UtcNow.Date.AddDays(1)-DateTime.UtcNow;
}
