using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class NutritionPushTests : IAsyncLifetime
{
    private readonly string dbPath = Path.Combine(Path.GetTempPath(), $"nutrition-push-{Guid.NewGuid():N}.db");
    private readonly Guid userId = Guid.NewGuid();
    private readonly FixedTimeProvider clock = new(new DateTimeOffset(2026, 9, 21, 12, 1, 0, TimeSpan.Zero));

    private AppDb Open() => new(new DbContextOptionsBuilder<AppDb>().UseSqlite($"Data Source={dbPath}").Options)
    {
        CurrentUser = userId
    };

    private static IConfiguration Config(string? projectId = "nutrition-test")
        => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Fcm:ProjectId"] = projectId,
            ["PublicOrigin"] = "https://nutrition.example.com"
        }).Build();

    public async Task InitializeAsync()
    {
        await using var db = Open();
        await db.Database.EnsureCreatedAsync();
        db.Users.Add(new AppUser
        {
            Id = userId,
            DisplayName = "push-test",
            IdentitySubject = $"push_{userId:N}",
            ProfileJson = Json.Write(new Profile { TimeZone = "Asia/Kuala_Lumpur" })
        });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(dbPath)) File.Delete(dbPath);
        return Task.CompletedTask;
    }

    [Fact]
    public async Task Dispatch_sends_one_generic_reminder_per_device_and_local_date()
    {
        var sender = new FakeSender();
        await using var db = Open();
        db.NutritionPushSubscriptions.Add(Subscription("device-a"));
        db.NutritionCheckInReminderPreferences.Add(Preference());
        await db.SaveChangesAsync();

        var service = new NutritionNotificationService(db, Config(), clock);
        var first = await service.DispatchDueAsync(sender, null, default);
        var second = await service.DispatchDueAsync(sender, null, default);

        Assert.True(first.Configured);
        Assert.Equal(1, first.Sent);
        Assert.Equal(0, second.Sent);
        Assert.Single(sender.Messages);
        Assert.Equal("Nutrition check-in", sender.Messages[0].Title);
        Assert.Equal("Open Nutrition to review your check-in.", sender.Messages[0].Body);
        Assert.Equal("/coach", sender.Messages[0].Route);
        Assert.DoesNotContain("weight", sender.Messages[0].Body, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("sent", (await db.NutritionPushReminderDeliveries.SingleAsync()).Status);
    }

    [Fact]
    public async Task Dispatch_preserves_the_native_platform_for_android_delivery()
    {
        var sender = new FakeSender();
        await using var db = Open();
        var subscription = Subscription("device-android");
        subscription.Platform = "android";
        db.NutritionPushSubscriptions.Add(subscription);
        db.NutritionCheckInReminderPreferences.Add(Preference());
        await db.SaveChangesAsync();

        var result = await new NutritionNotificationService(db, Config(), clock).DispatchDueAsync(sender, null, default);

        Assert.Equal(1, result.Sent);
        Assert.Equal("android", Assert.Single(sender.Messages).Platform);
    }

    [Fact]
    public async Task Dispatch_deduplicates_after_unsubscribe_and_resubscribe_on_the_same_day()
    {
        var sender = new FakeSender();
        await using var db = Open();
        db.NutritionPushSubscriptions.Add(Subscription("device-a"));
        db.NutritionCheckInReminderPreferences.Add(Preference());
        await db.SaveChangesAsync();
        var service = new NutritionNotificationService(db, Config(), clock);

        var first = await service.DispatchDueAsync(sender, null, default);
        var oldSubscriptionId = await db.NutritionPushSubscriptions.Select(item => item.Id).SingleAsync();
        await service.UnsubscribeDeviceAsync("device-a", "token-device-a", default);
        await service.RegisterDeviceAsync("device-a", "refreshed-token", default);
        var newSubscriptionId = await db.NutritionPushSubscriptions.Select(item => item.Id).SingleAsync();
        var second = await service.DispatchDueAsync(sender, null, default);

        Assert.Equal(1, first.Sent);
        Assert.NotEqual(oldSubscriptionId, newSubscriptionId);
        Assert.Equal(0, second.Sent);
        Assert.Single(sender.Messages);
        var delivery = await db.NutritionPushReminderDeliveries.SingleAsync();
        Assert.Equal("device-a", delivery.DeviceId);
        Assert.Equal("sent", delivery.Status);
    }

    [Fact]
    public async Task Dispatch_ttl_is_limited_to_the_remaining_delivery_window()
    {
        var sender = new FakeSender();
        await using var db = Open();
        db.NutritionPushSubscriptions.Add(Subscription("device-a"));
        db.NutritionCheckInReminderPreferences.Add(Preference());
        await db.SaveChangesAsync();
        clock.Set(new DateTimeOffset(2026, 9, 21, 12, 25, 0, TimeSpan.Zero));

        var result = await new NutritionNotificationService(db, Config(), clock).DispatchDueAsync(sender, null, default);

        Assert.Equal(1, result.Sent);
        Assert.Equal(TimeSpan.FromMinutes(5), Assert.Single(sender.Messages).TimeToLive);
    }

    [Fact]
    public async Task Dispatch_retries_transient_failures_only_after_the_retry_time()
    {
        var sender = new FakeSender
        {
            Results = new Queue<NutritionPushSendStatus>([
                NutritionPushSendStatus.TransientFailure,
                NutritionPushSendStatus.Sent])
        };
        await using var db = Open();
        db.NutritionPushSubscriptions.Add(Subscription("device-a"));
        db.NutritionCheckInReminderPreferences.Add(Preference());
        await db.SaveChangesAsync();
        var service = new NutritionNotificationService(db, Config(), clock);

        var failed = await service.DispatchDueAsync(sender, null, default);
        Assert.Equal(1, failed.Failed);
        Assert.Equal("retry", (await db.NutritionPushReminderDeliveries.SingleAsync()).Status);

        clock.Set(new DateTimeOffset(2026, 9, 21, 12, 2, 0, TimeSpan.Zero));
        var tooSoon = await service.DispatchDueAsync(sender, null, default);
        Assert.Equal(0, tooSoon.Sent);
        Assert.Single(sender.Messages);

        clock.Set(new DateTimeOffset(2026, 9, 21, 12, 3, 0, TimeSpan.Zero));
        var retried = await service.DispatchDueAsync(sender, null, default);
        Assert.Equal(1, retried.Sent);
        Assert.Equal(2, sender.Messages.Count);
        Assert.Equal("sent", (await db.NutritionPushReminderDeliveries.SingleAsync()).Status);
    }

    [Fact]
    public async Task Dispatch_skips_when_check_in_is_already_resolved()
    {
        var sender = new FakeSender();
        await using var db = Open();
        db.NutritionPushSubscriptions.Add(Subscription("device-a"));
        db.NutritionCheckInReminderPreferences.Add(Preference());
        db.CheckIns.Add(new CheckInDecision
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Revision = 1,
            WeekStart = new DateOnly(2026, 9, 21),
            CheckInWeekday = 1,
            Date = new DateOnly(2026, 9, 21),
            Decision = "declined"
        });
        await db.SaveChangesAsync();

        var result = await new NutritionNotificationService(db, Config(), clock).DispatchDueAsync(sender, null, default);

        Assert.Equal(0, result.Sent);
        Assert.Empty(sender.Messages);
        Assert.Empty(await db.NutritionPushReminderDeliveries.ToListAsync());
    }

    [Fact]
    public async Task Dispatch_stays_disabled_without_a_firebase_project()
    {
        var sender = new FakeSender();
        await using var db = Open();
        db.NutritionPushSubscriptions.Add(Subscription("device-a"));
        db.NutritionCheckInReminderPreferences.Add(Preference());
        await db.SaveChangesAsync();

        var result = await new NutritionNotificationService(db, Config("__not_configured__"), clock).DispatchDueAsync(sender, null, default);

        Assert.False(result.Configured);
        Assert.Empty(sender.Messages);
        Assert.Empty(await db.NutritionPushReminderDeliveries.ToListAsync());
    }

    [Fact]
    public async Task Settings_and_subscriptions_are_account_scoped_and_revoke_removes_the_token()
    {
        var otherUser = Guid.NewGuid();
        await using (var db = Open())
        {
            db.NutritionPushSubscriptions.Add(Subscription("device-a"));
            db.NutritionCheckInReminderPreferences.Add(Preference());
            db.Users.Add(TestUsers.Create("other", id: otherUser));
            await db.SaveChangesAsync();
        }

        await using var current = Open();
        var service = new NutritionNotificationService(current, Config(), clock);
        Assert.True((await service.GetStatusAsync("device-a", default)).ThisDeviceSubscribed);
        Assert.False(await service.UnsubscribeDeviceAsync("device-a", "stale-token", default));
        Assert.Single(await current.NutritionPushSubscriptions.ToListAsync());
        Assert.True(await service.UnsubscribeDeviceAsync("device-a", "token-device-a", default));
        Assert.Empty(await current.NutritionPushSubscriptions.ToListAsync());

        current.CurrentUser = otherUser;
        Assert.Empty(await current.NutritionPushSubscriptions.ToListAsync());
        Assert.False((await new NutritionNotificationService(current, Config(), clock).GetSettingsAsync(default)).Enabled);
    }

    [Fact]
    public async Task Stale_revocation_cannot_remove_a_refreshed_token_for_the_same_account_and_device()
    {
        await using var db = Open();
        db.NutritionPushSubscriptions.Add(Subscription("device-a"));
        await db.SaveChangesAsync();
        var service = new NutritionNotificationService(db, Config(), clock);
        await service.RegisterDeviceAsync("device-a", "new-token", default);

        Assert.False(await service.UnsubscribeDeviceAsync("device-a", "token-device-a", default));
        Assert.Equal("new-token", (await db.NutritionPushSubscriptions.SingleAsync()).FcmToken);
        Assert.True(await service.UnsubscribeDeviceAsync("device-a", "new-token", default));
        Assert.Empty(await db.NutritionPushSubscriptions.ToListAsync());
    }

    [Fact]
    public async Task Registration_stores_platform_and_defaults_legacy_clients_to_web()
    {
        await using var db = Open();
        var service = new NutritionNotificationService(db, Config(), clock);

        await service.RegisterDeviceAsync("device-a", "android-token", default, "android");
        var subscription = await db.NutritionPushSubscriptions.SingleAsync();
        Assert.Equal("android", subscription.Platform);

        await service.RegisterDeviceAsync("device-a", "web-token", default);
        subscription = await db.NutritionPushSubscriptions.SingleAsync();
        Assert.Equal("web", subscription.Platform);
        Assert.Equal("web-token", subscription.FcmToken);
    }

    [Fact]
    public async Task Registration_rejects_unknown_platforms()
    {
        await using var db = Open();
        var service = new NutritionNotificationService(db, Config(), clock);

        var error = await Assert.ThrowsAsync<DomainException>(() =>
            service.RegisterDeviceAsync("device-a", "token", default, "windows"));

        Assert.Equal("Choose a supported notification platform.", error.Message);
    }

    [Fact]
    public void Fcm_payload_uses_webpush_data_for_browsers_and_visible_notifications_for_android()
    {
        var content = new NutritionPushContent(
            "Nutrition check-in", "Open Nutrition to review your check-in.",
            "nutrition-check-in", "/coach", TimeSpan.FromMinutes(12));

        using var web = JsonDocument.Parse(JsonSerializer.Serialize(
            NutritionFcmPushSender.BuildMessagePayload("web-token", content)));
        var webMessage = web.RootElement.GetProperty("message");
        Assert.True(webMessage.TryGetProperty("webpush", out _));
        Assert.False(webMessage.TryGetProperty("notification", out _));
        Assert.Equal("/coach", webMessage.GetProperty("data").GetProperty("route").GetString());

        using var android = JsonDocument.Parse(JsonSerializer.Serialize(
            NutritionFcmPushSender.BuildMessagePayload("android-token", content with { Platform = "android" })));
        var androidMessage = android.RootElement.GetProperty("message");
        Assert.False(androidMessage.TryGetProperty("webpush", out _));
        Assert.Equal("Nutrition check-in", androidMessage.GetProperty("notification").GetProperty("title").GetString());
        Assert.Equal("720s", androidMessage.GetProperty("android").GetProperty("ttl").GetString());
        Assert.Equal("nutrition-reminders", androidMessage.GetProperty("android").GetProperty("notification").GetProperty("channel_id").GetString());
        Assert.Equal("/coach", androidMessage.GetProperty("data").GetProperty("route").GetString());
    }

    [Fact]
    public void Due_window_uses_the_selected_timezone_and_skips_dst_gaps()
    {
        Assert.True(NutritionNotificationService.TryGetDueDate(
            1, new TimeOnly(20, 0), "Asia/Kuala_Lumpur",
            new DateTimeOffset(2026, 9, 21, 12, 1, 0, TimeSpan.Zero), out var date, out var remainingTtl));
        Assert.Equal(new DateOnly(2026, 9, 21), date);
        Assert.Equal(TimeSpan.FromMinutes(29), remainingTtl);

        Assert.False(NutritionNotificationService.TryGetDueDate(
            0, new TimeOnly(2, 30), "America/New_York",
            new DateTimeOffset(2026, 3, 8, 7, 0, 0, TimeSpan.Zero), out _, out _));
    }

    [Theory]
    [InlineData("UNREGISTERED", true)]
    [InlineData("INVALID_ARGUMENT", true)]
    [InlineData("SENDER_ID_MISMATCH", false)]
    public void Fcm_error_classifier_only_retires_known_invalid_registrations(string errorCode, bool expected)
    {
        var body = JsonSerializer.Serialize(new
        {
            error = new
            {
                details = new[]
                {
                    new Dictionary<string, string>
                    {
                        ["@type"] = "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                        ["errorCode"] = errorCode
                    }
                }
            }
        });

        Assert.Equal(expected, NutritionFcmPushSender.IsInvalidOrUnregistered(body));
    }

    private NutritionPushSubscription Subscription(string deviceId) => new()
    {
        UserId = userId,
        DeviceId = deviceId,
        FcmToken = $"token-{deviceId}",
        CreatedAt = clock.GetUtcNow().UtcDateTime,
        UpdatedAt = clock.GetUtcNow().UtcDateTime
    };

    private NutritionCheckInReminderPreference Preference() => new()
    {
        UserId = userId,
        Enabled = true,
        Weekday = 1,
        LocalTime = new TimeOnly(20, 0),
        TimeZoneId = "Asia/Kuala_Lumpur",
        UpdatedAt = clock.GetUtcNow().UtcDateTime
    };

    private sealed class FakeSender : INutritionPushSender
    {
        public List<NutritionPushContent> Messages { get; } = [];
        public Queue<NutritionPushSendStatus> Results { get; init; } = new([NutritionPushSendStatus.Sent]);

        public Task<NutritionPushSendResult> SendAsync(string token, NutritionPushContent content, CancellationToken ct)
        {
            Messages.Add(content);
            var result = Results.Count == 0 ? NutritionPushSendStatus.Sent : Results.Dequeue();
            return Task.FromResult(new NutritionPushSendResult(result));
        }
    }

    private sealed class FixedTimeProvider(DateTimeOffset initial) : TimeProvider
    {
        private DateTimeOffset now = initial;
        public override DateTimeOffset GetUtcNow() => now;
        public void Set(DateTimeOffset value) => now = value;
    }
}
