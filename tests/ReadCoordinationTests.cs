using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class ReadCoordinationTests
{
    [Fact]
    public void Validators_include_account_date_retention_and_domain_revisions()
    {
        var user = new AppUser {Id=Guid.NewGuid(),Revision=1};
        var day = new DateOnly(2026,9,28);
        var tag = ReadValidators.Bootstrap(user,day,90,0,0,false,false);
        Assert.NotEqual(tag,ReadValidators.Bootstrap(user,day.AddDays(1),90,0,0,false,false));
        Assert.NotEqual(tag,ReadValidators.Bootstrap(user,day,30,0,0,false,false));
        Assert.NotEqual(tag,ReadValidators.Bootstrap(user,day,90,1,0,false,false));
        Assert.NotEqual(tag,ReadValidators.Bootstrap(user,day,90,0,1,false,false));
        user.FoodRevision++;
        Assert.NotEqual(tag,ReadValidators.Bootstrap(user,day,90,0,0,false,false));
        var progress = ReadValidators.Progress(user,"month",day);
        Assert.NotEqual(progress,ReadValidators.Progress(user,"year",day));
        Assert.NotEqual(progress,ReadValidators.Progress(user,"month",day.AddDays(1)));
        user.Id = Guid.NewGuid();
        Assert.NotEqual(progress,ReadValidators.Progress(user,"month",day));
    }

    [Fact]
    public async Task Shared_read_waiters_cancel_without_poisoning_the_next_request()
    {
        var key = Guid.NewGuid().ToString();
        using var owner = await ReadGate.Enter(key,default);
        using var canceled = new CancellationTokenSource();
        var waiting = ReadGate.Enter(key,canceled.Token);
        Assert.False(waiting.IsCompleted);
        canceled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>waiting);
        using var other = await ReadGate.Enter(key+":other-account",default);
        var next = ReadGate.Enter(key,default);
        Assert.False(next.IsCompleted);
        owner.Dispose();
        using var acquired = await next.WaitAsync(TimeSpan.FromSeconds(2));
        acquired.Dispose();
        using var retry = await ReadGate.Enter(key,default);
    }
}
