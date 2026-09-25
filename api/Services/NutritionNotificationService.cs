using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record NutritionReminderSettings(
    bool Configured,
    bool Enabled,
    int Weekday,
    string LocalTime,
    string TimeZoneId);

public sealed record NutritionNotificationStatus(
    bool Configured,
    bool ThisDeviceSubscribed,
    bool ReminderEnabled,
    int Weekday,
    string LocalTime,
    string TimeZoneId);

public sealed record NutritionPushDispatchSummary(int Sent, int Skipped, int Disabled, int Failed, bool Configured);

public sealed partial class NutritionNotificationService(
    AppDb db,
    IConfiguration configuration,
    TimeProvider? timeProvider = null)
{
    private readonly TimeProvider clock = timeProvider ?? TimeProvider.System;

    public bool Configured => !string.IsNullOrWhiteSpace(configuration["Fcm:ProjectId"])
        && !string.Equals(configuration["Fcm:ProjectId"], "__not_configured__", StringComparison.Ordinal);

    public async Task<NutritionReminderSettings> GetSettingsAsync(CancellationToken ct)
    {
        var preference = await db.NutritionCheckInReminderPreferences.SingleOrDefaultAsync(ct);
        if (preference is not null) return ToSettings(preference);

        var user = await db.Users.AsNoTracking().SingleAsync(x => x.Id == db.CurrentUser, ct);
        var timeZoneId = "Asia/Kuala_Lumpur";
        if (!string.IsNullOrWhiteSpace(user.ProfileJson))
            timeZoneId = Json.Read<Profile>(user.ProfileJson).TimeZone;

        return new(Configured, false, 1, "19:00", timeZoneId);
    }

    public async Task<NutritionNotificationStatus> GetStatusAsync(string? deviceId, CancellationToken ct)
    {
        var settings = await GetSettingsAsync(ct);
        var subscribed = !string.IsNullOrWhiteSpace(deviceId) && await db.NutritionPushSubscriptions
            .AnyAsync(subscription => subscription.DeviceId == deviceId, ct);
        return new(Configured, subscribed, settings.Enabled, settings.Weekday, settings.LocalTime, settings.TimeZoneId);
    }

    public async Task<NutritionReminderSettings> SetSettingsAsync(
        bool enabled,
        int weekday,
        string localTime,
        string timeZoneId,
        CancellationToken ct)
    {
        Validation.Require(weekday is >= 0 and <= 6, "Choose a weekday from Sunday to Saturday.");
        Validation.Require(TimeOnly.TryParseExact(localTime, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedTime), "Choose a reminder time in 24-hour HH:mm format.");
        Validation.Require(!string.IsNullOrWhiteSpace(timeZoneId) && timeZoneId.Trim().Length <= 120, "Choose a supported time zone.");
        try { _ = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId.Trim()); }
        catch (TimeZoneNotFoundException) { throw new DomainException("Choose a supported time zone."); }
        catch (InvalidTimeZoneException) { throw new DomainException("Choose a supported time zone."); }

        if (enabled)
        {
            Validation.Require(Configured, "Nutrition reminders are not configured yet.", 503);
            Validation.Require(await db.NutritionPushSubscriptions.AnyAsync(ct), "Turn on notifications on at least one device first.", 409);
        }

        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        var now = clock.GetUtcNow().UtcDateTime;
        var preference = await db.NutritionCheckInReminderPreferences.SingleOrDefaultAsync(ct);
        if (preference is null)
        {
            preference = new NutritionCheckInReminderPreference { UserId = userId };
            db.NutritionCheckInReminderPreferences.Add(preference);
        }

        preference.Enabled = enabled;
        preference.Weekday = weekday;
        preference.LocalTime = parsedTime;
        preference.TimeZoneId = timeZoneId.Trim();
        preference.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        return ToSettings(preference);
    }

    public async Task RegisterDeviceAsync(string deviceId, string fcmToken, CancellationToken ct, string? platform = null)
    {
        Validation.Require(Configured, "Nutrition notifications are not configured yet.", 503);
        Validation.Require(!string.IsNullOrWhiteSpace(deviceId) && deviceId.Trim().Length <= 200, "A valid device id is required.");
        Validation.Require(!string.IsNullOrWhiteSpace(fcmToken) && fcmToken.Trim().Length <= 4096, "A valid notification token is required.");
        var cleanPlatform = string.IsNullOrWhiteSpace(platform) ? "web" : platform.Trim().ToLowerInvariant();
        Validation.Require(cleanPlatform is "web" or "android", "Choose a supported notification platform.");
        var userId = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        var now = clock.GetUtcNow().UtcDateTime;
        var cleanDeviceId = deviceId.Trim();
        var subscription = await db.NutritionPushSubscriptions.SingleOrDefaultAsync(x => x.DeviceId == cleanDeviceId, ct);
        if (subscription is null)
        {
            subscription = new NutritionPushSubscription { UserId = userId, DeviceId = cleanDeviceId };
            db.NutritionPushSubscriptions.Add(subscription);
        }

        subscription.Platform = cleanPlatform;
        subscription.FcmToken = fcmToken.Trim();
        subscription.UpdatedAt = now;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Multiple tabs can ask permission and register the same browser concurrently. The
            // unique user/device key selects one row, then the losing request updates that row.
            db.Entry(subscription).State = EntityState.Detached;
            var winner = await db.NutritionPushSubscriptions.SingleAsync(x => x.DeviceId == cleanDeviceId, ct);
            winner.Platform = cleanPlatform;
            winner.FcmToken = fcmToken.Trim();
            winner.UpdatedAt = now;
            await db.SaveChangesAsync(ct);
        }
    }

    public async Task<bool> UnsubscribeDeviceAsync(string deviceId, string fcmToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(deviceId) || string.IsNullOrWhiteSpace(fcmToken)) return false;
        var subscription = await db.NutritionPushSubscriptions.SingleOrDefaultAsync(x => x.DeviceId == deviceId.Trim(), ct);
        if (subscription is null || !string.Equals(subscription.FcmToken, fcmToken.Trim(), StringComparison.Ordinal)) return false;
        db.NutritionPushSubscriptions.Remove(subscription);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<int> CleanupAsync(DateTime utcNow, CancellationToken ct)
    {
        var oldDeliveries = await db.NutritionPushReminderDeliveries.IgnoreQueryFilters()
            .Where(delivery => delivery.ExpiresAt <= utcNow)
            .OrderBy(delivery => delivery.ExpiresAt)
            .Take(1000)
            .ExecuteDeleteAsync(ct);
        return oldDeliveries;
    }

    private NutritionReminderSettings ToSettings(NutritionCheckInReminderPreference preference)
        => new(Configured, preference.Enabled, preference.Weekday, preference.LocalTime.ToString("HH:mm", CultureInfo.InvariantCulture), preference.TimeZoneId);

    private static bool IsUniqueViolation(DbUpdateException exception)
        => exception.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation }
            or Microsoft.Data.Sqlite.SqliteException { SqliteExtendedErrorCode: 1555 or 2067 };

}
