using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// Reminders are woken by one scheduled task per due time instead of a job that polls every few minutes.
public sealed class NutritionCheckInWakeTests : IAsyncLifetime
{
    private readonly string dbPath = Path.Combine(Path.GetTempPath(), $"nutrition-wake-{Guid.NewGuid():N}.db");
    private readonly Guid userId = Guid.NewGuid();
    // Monday 2026-09-21 12:01 UTC = 20:01 in Kuala Lumpur.
    private readonly DateTimeOffset now = new(2026, 9, 21, 12, 1, 0, TimeSpan.Zero);

    private AppDb Open() => new(new DbContextOptionsBuilder<AppDb>().UseSqlite($"Data Source={dbPath}").Options) { CurrentUser = userId };

    private static IConfiguration Config() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Fcm:ProjectId"] = "nutrition-test",
        ["PublicOrigin"] = "https://nutrition.example.com"
    }).Build();

    public async Task InitializeAsync()
    {
        await using var db = Open();
        await db.Database.EnsureCreatedAsync();
        db.Users.Add(new AppUser { Id = userId, DisplayName = "wake", IdentitySubject = $"wake_{userId:N}", ProfileJson = Json.Write(new Profile { TimeZone = "Asia/Kuala_Lumpur" }) });
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(dbPath)) File.Delete(dbPath);
        return Task.CompletedTask;
    }

    [Fact]
    public void Next_due_is_the_next_local_occurrence_strictly_after_now()
    {
        var eight = new TimeOnly(8, 0);
        // Wednesday: the coming Monday 08:00 in Kuala Lumpur is 00:00 UTC.
        Assert.Equal(new DateTimeOffset(2026, 9, 28, 0, 0, 0, TimeSpan.Zero),
            NutritionReminderSchedule.NextDueUtc(1, eight, "Asia/Kuala_Lumpur", new DateTimeOffset(2026, 9, 23, 5, 0, 0, TimeSpan.Zero)));
        // Earlier the same day it is still today.
        Assert.Equal(new DateTimeOffset(2026, 9, 21, 0, 0, 0, TimeSpan.Zero),
            NutritionReminderSchedule.NextDueUtc(1, eight, "Asia/Kuala_Lumpur", new DateTimeOffset(2026, 9, 20, 23, 0, 0, TimeSpan.Zero)));
        // Exactly at the scheduled instant the next one is a week away: the due window handles the current one.
        Assert.Equal(new DateTimeOffset(2026, 9, 28, 0, 0, 0, TimeSpan.Zero),
            NutritionReminderSchedule.NextDueUtc(1, eight, "Asia/Kuala_Lumpur", new DateTimeOffset(2026, 9, 21, 0, 0, 0, TimeSpan.Zero)));
    }

    [Fact]
    public void Next_due_follows_dst_like_the_due_window_does()
    {
        // 02:30 on Sunday 2026-03-08 does not exist in New York, so that week has no reminder; the next is EDT (UTC-4).
        Assert.Equal(new DateTimeOffset(2026, 3, 15, 6, 30, 0, TimeSpan.Zero),
            NutritionReminderSchedule.NextDueUtc(0, new TimeOnly(2, 30), "America/New_York", new DateTimeOffset(2026, 3, 6, 0, 0, 0, TimeSpan.Zero)));
        // 01:30 on 2026-11-01 happens twice; the later offset is used, as in TryGetDueDate.
        Assert.Equal(new DateTimeOffset(2026, 11, 1, 5, 30, 0, TimeSpan.Zero),
            NutritionReminderSchedule.NextDueUtc(0, new TimeOnly(1, 30), "America/New_York", new DateTimeOffset(2026, 10, 30, 0, 0, 0, TimeSpan.Zero)));
        Assert.Null(NutritionReminderSchedule.NextDueUtc(1, new TimeOnly(8, 0), "Not/AZone", now));
        Assert.Null(NutritionReminderSchedule.NextDueUtc(9, new TimeOnly(8, 0), "Asia/Kuala_Lumpur", now));
    }

    [Fact]
    public async Task Saving_an_enabled_reminder_arms_its_next_occurrence()
    {
        var queue = new FakeQueue();
        await using var db = Open();
        db.NutritionPushSubscriptions.Add(Subscription());
        await db.SaveChangesAsync();
        var service = new NutritionNotificationService(db, Config(), new FixedTime(now), queue);

        await service.SetSettingsAsync(true, 1, "08:00", "Asia/Kuala_Lumpur", default);

        Assert.Equal([new DateTimeOffset(2026, 9, 28, 0, 0, 0, TimeSpan.Zero)], queue.Wakes);
    }

    [Fact]
    public async Task Saving_a_reminder_arms_only_the_saving_account_and_leaves_others_to_dispatch_and_cleanup()
    {
        var queue = new FakeQueue();
        var other = Guid.NewGuid();
        await using (var seed = Open())
        {
            seed.CurrentUser = other;
            seed.Users.Add(new AppUser { Id = other, DisplayName = "other", IdentitySubject = $"wake_{other:N}" });
            seed.NutritionCheckInReminderPreferences.Add(new NutritionCheckInReminderPreference
            {
                UserId = other, Enabled = true, Weekday = 3, LocalTime = new TimeOnly(9, 0), TimeZoneId = "Asia/Kuala_Lumpur",
                UpdatedAt = now.UtcDateTime
            });
            await seed.SaveChangesAsync();
        }
        await using var db = Open();
        db.NutritionPushSubscriptions.Add(Subscription());
        await db.SaveChangesAsync();

        await new NutritionNotificationService(db, Config(), new FixedTime(now), queue).SetSettingsAsync(true, 1, "08:00", "Asia/Kuala_Lumpur", default);

        Assert.Equal([new DateTimeOffset(2026, 9, 28, 0, 0, 0, TimeSpan.Zero)], queue.Wakes);
    }

    [Fact]
    public async Task Saving_a_disabled_reminder_arms_nothing()
    {
        var queue = new FakeQueue();
        await using var db = Open();
        var service = new NutritionNotificationService(db, Config(), new FixedTime(now), queue);

        await service.SetSettingsAsync(false, 1, "08:00", "Asia/Kuala_Lumpur", default);

        Assert.Empty(queue.Wakes);
    }

    [Fact]
    public async Task A_failed_send_arms_a_retry_after_the_retry_delay_and_the_next_week()
    {
        var queue = new FakeQueue();
        await using var db = Open();
        db.NutritionPushSubscriptions.Add(Subscription());
        db.NutritionCheckInReminderPreferences.Add(Preference());
        await db.SaveChangesAsync();
        var service = new NutritionNotificationService(db, Config(), new FixedTime(now), queue);
        var sender = new FailingSender();

        var result = await service.DispatchDueAsync(sender, null, default);

        Assert.Equal(1, result.Failed);
        // The retry wake lands after the two-minute delivery retry so it is never skipped as too early.
        Assert.Contains(queue.Wakes, at => at > now.AddMinutes(2) && at < now.AddMinutes(4));
        Assert.Contains(new DateTimeOffset(2026, 9, 28, 12, 0, 0, TimeSpan.Zero), queue.Wakes);
    }

    [Fact]
    public async Task A_clean_dispatch_only_arms_the_next_week()
    {
        var queue = new FakeQueue();
        await using var db = Open();
        db.NutritionPushSubscriptions.Add(Subscription());
        db.NutritionCheckInReminderPreferences.Add(Preference());
        await db.SaveChangesAsync();
        var service = new NutritionNotificationService(db, Config(), new FixedTime(now), queue);

        await service.DispatchDueAsync(new OkSender(), null, default);

        Assert.Equal([new DateTimeOffset(2026, 9, 28, 12, 0, 0, TimeSpan.Zero)], queue.Wakes);
    }

    [Fact]
    public async Task Daily_cleanup_rearms_every_enabled_reminder_so_a_lost_task_heals()
    {
        var queue = new FakeQueue();
        await using var db = Open();
        db.NutritionCheckInReminderPreferences.Add(Preference());
        await db.SaveChangesAsync();
        var service = new NutritionNotificationService(db, Config(), new FixedTime(now), queue);

        await service.CleanupAsync(now.UtcDateTime, default);

        Assert.Equal([new DateTimeOffset(2026, 9, 28, 12, 0, 0, TimeSpan.Zero)], queue.Wakes);
    }

    private NutritionPushSubscription Subscription() => new()
    {
        UserId = userId, DeviceId = "device-a", FcmToken = "token-a",
        CreatedAt = now.UtcDateTime, UpdatedAt = now.UtcDateTime
    };

    private NutritionCheckInReminderPreference Preference() => new()
    {
        UserId = userId, Enabled = true, Weekday = 1, LocalTime = new TimeOnly(20, 0),
        TimeZoneId = "Asia/Kuala_Lumpur", UpdatedAt = now.UtcDateTime
    };

    private sealed class FakeQueue : INutritionWakeQueue
    {
        public List<DateTimeOffset> Wakes { get; } = [];
        public bool Configured => true;
        public Task<bool> EnsureWakeAsync(DateTimeOffset at, CancellationToken ct) { Wakes.Add(at); return Task.FromResult(true); }
    }

    private sealed class OkSender : INutritionPushSender
    {
        public Task<NutritionPushSendResult> SendAsync(string token, NutritionPushContent content, CancellationToken ct)
            => Task.FromResult(new NutritionPushSendResult(NutritionPushSendStatus.Sent));
    }

    private sealed class FailingSender : INutritionPushSender
    {
        public Task<NutritionPushSendResult> SendAsync(string token, NutritionPushContent content, CancellationToken ct)
            => Task.FromResult(new NutritionPushSendResult(NutritionPushSendStatus.TransientFailure));
    }

    private sealed class FixedTime(DateTimeOffset value) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => value;
    }
}
