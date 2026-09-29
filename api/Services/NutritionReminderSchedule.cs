namespace Nutrition.Api.Services;

/// Local-time arithmetic shared by the reminder due window and the wake-up scheduling, so the two
/// can never disagree about when a reminder is due (DST gaps and overlaps included).
internal static class NutritionReminderSchedule
{
    /// The UTC instant a reminder scheduled for <paramref name="localTime"/> on <paramref name="date"/> is due,
    /// or null when that local time does not exist (a DST gap). An ambiguous time uses the later offset.
    public static DateTimeOffset? ScheduledUtc(TimeZoneInfo zone, DateOnly date, TimeOnly localTime)
    {
        var local = DateTime.SpecifyKind(date.ToDateTime(localTime), DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local)) return null;
        var offset = zone.IsAmbiguousTime(local)
            ? zone.GetAmbiguousTimeOffsets(local).Max()
            : zone.GetUtcOffset(local);
        return new DateTimeOffset(local, offset).ToUniversalTime();
    }

    /// The next scheduled instant strictly after <paramref name="utcNow"/>, or null for an unusable
    /// weekday or time zone. A week whose local time falls in a DST gap has no reminder and is skipped,
    /// matching what the due window would do.
    public static DateTimeOffset? NextDueUtc(int weekday, TimeOnly localTime, string timeZoneId, DateTimeOffset utcNow)
    {
        if (weekday is < 0 or > 6) return null;
        TimeZoneInfo zone;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId); }
        catch (TimeZoneNotFoundException) { return null; }
        catch (InvalidTimeZoneException) { return null; }

        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(utcNow, zone).DateTime);
        // Two weeks is enough to step over one skipped (DST-gap) occurrence.
        for (var days = 0; days <= 14; days++)
        {
            var date = today.AddDays(days);
            if ((int)date.DayOfWeek != weekday) continue;
            if (ScheduledUtc(zone, date, localTime) is { } due && due > utcNow) return due;
        }
        return null;
    }
}
