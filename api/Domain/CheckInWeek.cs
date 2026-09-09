namespace Nutrition.Api.Domain;

public static class CheckInWeek
{
    public static DateOnly WeekStart(DateOnly date)
        => date.AddDays(-((int)date.DayOfWeek + 6) % 7);

    public static DateOnly NextCheckIn(DateOnly lastPlan)
        => WeekStart(lastPlan).AddDays(7);
}
