using Microsoft.EntityFrameworkCore;

namespace Nutrition.Api.Services;

public sealed partial class NutritionNotificationService
{
    /// Makes sure a wake-up exists for every enabled reminder's next occurrence. Idempotent and best effort:
    /// the dispatcher re-arms after each run, saving a schedule arms it at once, and the daily maintenance
    /// run repairs anything a failed scheduling call left behind.
    public async Task ArmWakesAsync(CancellationToken ct)
    {
        if (wakes is null || !wakes.Configured) return;
        var now = clock.GetUtcNow();
        var preferences = await db.NutritionCheckInReminderPreferences.IgnoreQueryFilters().AsNoTracking()
            .Where(preference => preference.Enabled)
            .Select(preference => new { preference.Weekday, preference.LocalTime, preference.TimeZoneId })
            .Take(500)
            .ToListAsync(ct);
        var due = preferences
            .Select(preference => NutritionReminderSchedule.NextDueUtc(preference.Weekday, preference.LocalTime, preference.TimeZoneId, now))
            .OfType<DateTimeOffset>()
            .Distinct();
        foreach (var at in due) await wakes.EnsureWakeAsync(at, ct);
    }
}
