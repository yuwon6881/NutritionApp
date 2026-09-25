using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed partial class NutritionNotificationService
{
    private static readonly TimeSpan DeliveryWindow = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan DeliveryLeaseDuration = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan DeliveryRetry = TimeSpan.FromMinutes(2);
    private const int MaximumAttempts = 5;
    public async Task<NutritionPushDispatchSummary> DispatchDueAsync(
        INutritionPushSender sender,
        ILogger<NutritionNotificationService>? logger,
        CancellationToken ct)
    {
        if (!Configured)
        {
            logger?.LogInformation("Nutrition push dispatch skipped because Fcm:ProjectId is not configured.");
            return new(0, 0, 0, 0, false);
        }

        var now = clock.GetUtcNow();
        var candidates = await db.NutritionCheckInReminderPreferences.IgnoreQueryFilters()
            .Where(preference => preference.Enabled)
            .OrderBy(preference => preference.UserId)
            .Select(preference => new
            {
                preference.UserId,
                preference.Weekday,
                preference.LocalTime,
                preference.TimeZoneId
            })
            .Take(500)
            .ToListAsync(ct);

        var sent = 0;
        var skipped = 0;
        var disabled = 0;
        var failed = 0;
        foreach (var candidate in candidates)
        {
            if (!TryGetDueDate(candidate.Weekday, candidate.LocalTime, candidate.TimeZoneId, now, out var reminderDate, out var remainingTtl))
                continue;

            db.ChangeTracker.Clear();
            db.CurrentUser = candidate.UserId;
            var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(item => item.Id == candidate.UserId, ct);
            if (user is null || !HasCheckInProfile(user.ProfileJson))
            {
                skipped++;
                continue;
            }

            var profile = Json.Read<Profile>(user.ProfileJson);
            var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(profile.TimeZone)).DateTime);
            var cadenceWeekday = user.CheckInWeekday is >= 0 and <= 6 ? user.CheckInWeekday : CheckInWeek.Monday;
            var checkInWeek = CheckInWeek.PeriodStart(today, cadenceWeekday);
            var alreadyResolved = await db.CheckIns.AnyAsync(item => item.WeekStart == checkInWeek && !item.Deleted, ct);
            if (!alreadyResolved)
            {
                var acceptedPlans = await db.Plans.Where(item => !item.Deleted && item.Date >= checkInWeek && item.Date <= today)
                    .Select(item => new { item.Date, item.CheckInWeekday })
                    .ToListAsync(ct);
                alreadyResolved = acceptedPlans.Any(item => CheckInWeek.PeriodStart(item.Date, item.CheckInWeekday) == checkInWeek);
            }
            if (alreadyResolved)
            {
                skipped++;
                continue;
            }

            var subscriptions = await db.NutritionPushSubscriptions.AsNoTracking().ToListAsync(ct);
            if (subscriptions.Count == 0)
            {
                skipped++;
                continue;
            }

            foreach (var subscription in subscriptions)
            {
                var lease = await TryLeaseDeliveryAsync(candidate.UserId, subscription.DeviceId, reminderDate, now.UtcDateTime, ct);
                if (lease is null)
                {
                    skipped++;
                    continue;
                }

                NutritionPushSendResult result;
                try
                {
                    result = await sender.SendAsync(subscription.FcmToken, new NutritionPushContent(
                        "Nutrition check-in",
                        "Open Nutrition to review your check-in.",
                        "nutrition-check-in",
                        "/coach",
                        remainingTtl,
                        subscription.Platform), ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger?.LogWarning(ex, "Nutrition push sender failed for a reminder attempt.");
                    result = new(NutritionPushSendStatus.TransientFailure);
                }

                var outcome = await FinalizeDeliveryAsync(lease, subscription.Id, result.Status, now.UtcDateTime, ct);
                switch (outcome)
                {
                    case "sent": sent++; break;
                    case "disabled": disabled++; break;
                    case "retry": failed++; break;
                    default: skipped++; break;
                }
            }
        }

        return new(sent, skipped, disabled, failed, true);
    }

    private async Task<DeliveryLease?> TryLeaseDeliveryAsync(
        Guid userId,
        string deviceId,
        DateOnly reminderDate,
        DateTime now,
        CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        db.CurrentUser = userId;
        var delivery = await db.NutritionPushReminderDeliveries.SingleOrDefaultAsync(
            item => item.DeviceId == deviceId && item.ReminderDate == reminderDate, ct);
        if (delivery is null)
        {
            delivery = new NutritionPushReminderDelivery
            {
                UserId = userId,
                DeviceId = deviceId,
                ReminderDate = reminderDate,
                Status = "sending",
                Attempts = 1,
                LeaseId = Guid.NewGuid().ToString("N"),
                LeaseUntil = now.Add(DeliveryLeaseDuration),
                NextAttemptAt = now,
                CreatedAt = now,
                UpdatedAt = now,
                ExpiresAt = now.AddDays(90)
            };
            db.NutritionPushReminderDeliveries.Add(delivery);
            try
            {
                await db.SaveChangesAsync(ct);
                return new(userId, delivery.Id, delivery.LeaseId);
            }
            catch (DbUpdateException ex) when (IsUniqueViolation(ex))
            {
                db.Entry(delivery).State = EntityState.Detached;
                delivery = await db.NutritionPushReminderDeliveries.SingleOrDefaultAsync(
                    item => item.DeviceId == deviceId && item.ReminderDate == reminderDate, ct);
                if (delivery is null) return null;
            }
        }

        if (delivery.Status is "sent" or "disabled" or "failed" ||
            delivery.ExpiresAt <= now || delivery.NextAttemptAt > now || delivery.LeaseUntil > now ||
            delivery.Attempts >= MaximumAttempts)
            return null;

        delivery.Status = "sending";
        delivery.Attempts++;
        delivery.LeaseId = Guid.NewGuid().ToString("N");
        delivery.LeaseUntil = now.Add(DeliveryLeaseDuration);
        delivery.UpdatedAt = now;
        try
        {
            await db.SaveChangesAsync(ct);
            return new(userId, delivery.Id, delivery.LeaseId);
        }
        catch (DbUpdateConcurrencyException)
        {
            return null;
        }
    }

    private async Task<string> FinalizeDeliveryAsync(
        DeliveryLease lease,
        Guid subscriptionId,
        NutritionPushSendStatus status,
        DateTime now,
        CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        db.CurrentUser = lease.UserId;
        var delivery = await db.NutritionPushReminderDeliveries.SingleOrDefaultAsync(item => item.Id == lease.DeliveryId, ct);
        if (delivery is null || delivery.Status != "sending" || delivery.LeaseId != lease.LeaseId) return "skipped";

        if (status == NutritionPushSendStatus.Sent)
        {
            delivery.Status = "sent";
            delivery.SentAt = now;
            delivery.LeaseUntil = null;
            delivery.UpdatedAt = now;
            await db.SaveChangesAsync(ct);
            return "sent";
        }

        if (status == NutritionPushSendStatus.InvalidOrUnregistered)
        {
            var subscription = await db.NutritionPushSubscriptions.SingleOrDefaultAsync(item => item.Id == subscriptionId, ct);
            if (subscription is not null) db.NutritionPushSubscriptions.Remove(subscription);
            delivery.Status = "disabled";
            delivery.LeaseUntil = null;
            delivery.UpdatedAt = now;
            await db.SaveChangesAsync(ct);
            return "disabled";
        }

        delivery.Status = delivery.Attempts >= MaximumAttempts ? "failed" : "retry";
        delivery.NextAttemptAt = now.Add(DeliveryRetry);
        delivery.LeaseUntil = null;
        delivery.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        return delivery.Status;
    }

    internal static bool TryGetDueDate(
        int weekday,
        TimeOnly localTime,
        string timeZoneId,
        DateTimeOffset utcNow,
        out DateOnly reminderDate,
        out TimeSpan remainingTtl)
    {
        reminderDate = default;
        remainingTtl = TimeSpan.Zero;
        if (weekday is < 0 or > 6) return false;
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId); }
        catch (TimeZoneNotFoundException) { return false; }
        catch (InvalidTimeZoneException) { return false; }

        var localNow = TimeZoneInfo.ConvertTime(utcNow, zone);
        reminderDate = DateOnly.FromDateTime(localNow.DateTime);
        if ((int)localNow.DayOfWeek != weekday) return false;

        var localScheduled = DateTime.SpecifyKind(reminderDate.ToDateTime(localTime), DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(localScheduled)) return false;
        var offset = zone.IsAmbiguousTime(localScheduled)
            ? zone.GetAmbiguousTimeOffsets(localScheduled).Max()
            : zone.GetUtcOffset(localScheduled);
        var scheduledUtc = new DateTimeOffset(localScheduled, offset).ToUniversalTime();
        var lateness = utcNow - scheduledUtc;
        if (lateness < TimeSpan.Zero || lateness > DeliveryWindow) return false;
        remainingTtl = DeliveryWindow - lateness;
        return true;
    }

    private static bool HasCheckInProfile(string profileJson)
    {
        if (string.IsNullOrWhiteSpace(profileJson)) return false;
        try { _ = Json.Read<Profile>(profileJson); return true; }
        catch (System.Text.Json.JsonException) { return false; }
    }

    private sealed record DeliveryLease(Guid UserId, Guid DeliveryId, string LeaseId);
}
