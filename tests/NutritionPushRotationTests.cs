using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed partial class NutritionPushTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Revocation_with_a_stale_tracked_subscription_preserves_a_concurrently_rotated_token(bool capability)
    {
        await using var staleDb = Open();
        staleDb.NutritionPushSubscriptions.Add(Subscription("device-race"));
        await staleDb.SaveChangesAsync();
        // Keep the old subscription tracked while another request rotates its token.
        await using var otherDb = Open();
        await otherDb.NutritionPushSubscriptions.Where(x => x.DeviceId == "device-race")
            .ExecuteUpdateAsync(update => update.SetProperty(x => x.FcmToken, "rotated-token"));
        var service = new NutritionNotificationService(staleDb, Config(), clock);
        if (capability) await service.RevokeDeviceCapabilityAsync(userId, "device-race", "token-device-race", default);
        else Assert.False(await service.UnsubscribeDeviceAsync("device-race", "token-device-race", default));
        Assert.Equal("rotated-token", await otherDb.NutritionPushSubscriptions.Select(x => x.FcmToken).SingleAsync());
        await service.RevokeDeviceCapabilityAsync(userId, "device-race", "rotated-token", default);
        Assert.Empty(await otherDb.NutritionPushSubscriptions.ToListAsync());
    }
}
