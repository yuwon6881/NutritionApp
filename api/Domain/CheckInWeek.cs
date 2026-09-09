namespace Nutrition.Api.Domain;

public static class CheckInWeek
{
    public const int Monday = 1;

    public static void ValidateWeekday(int weekday)
        => Validation.Require(weekday is >= 0 and <= 6, "Choose a weekday from Sunday through Saturday.");

    public static DateOnly PeriodStart(DateOnly date, int weekday = Monday)
    {
        ValidateWeekday(weekday);
        var current = (int)date.DayOfWeek;
        return date.AddDays(-((current - weekday + 7) % 7));
    }

    public static DateOnly WeekStart(DateOnly date)
        => PeriodStart(date, Monday);

    public static DateOnly NextOccurrence(DateOnly date, int weekday)
    {
        ValidateWeekday(weekday);
        return date.AddDays((weekday - (int)date.DayOfWeek + 7) % 7);
    }

    public static DateOnly NextOccurrenceAfter(DateOnly date, int weekday)
    {
        var occurrence = NextOccurrence(date, weekday);
        return occurrence > date ? occurrence : occurrence.AddDays(7);
    }

    public static DateOnly NextCheckIn(DateOnly lastPlan, int weekday = Monday)
        => PeriodStart(lastPlan, weekday).AddDays(7);
}
