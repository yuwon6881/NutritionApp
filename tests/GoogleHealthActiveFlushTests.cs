using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// Queued uploads are sent on the user's own request, so no scheduled job has to wake the API for them.
public sealed class GoogleHealthActiveFlushTests
{
    [Fact]
    public async Task FlushFailureNeverFailsTheUsersRequest()
    {
        // No queue services are registered, so resolving them throws inside the flush.
        await using var provider = new ServiceCollection().BuildServiceProvider();

        var exception = await Record.ExceptionAsync(() => GoogleHealthOutboundSync.FlushForActiveUserAsync(
            provider.GetRequiredService<IServiceScopeFactory>(), Guid.NewGuid(), NullLogger.Instance, default));

        Assert.Null(exception);
    }

    [Fact]
    public async Task FlushWithoutASignedInUserDoesNothing()
    {
        await using var provider = new ServiceCollection().BuildServiceProvider();

        var exception = await Record.ExceptionAsync(() => GoogleHealthOutboundSync.FlushForActiveUserAsync(
            provider.GetRequiredService<IServiceScopeFactory>(), null, NullLogger.Instance, default));

        Assert.Null(exception);
    }
}
