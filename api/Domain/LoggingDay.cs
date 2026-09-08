namespace Nutrition.Api.Domain;

public static class LoggingDay
{
    public static string Status(DateOnly date, DateOnly today, string? status, bool hasFood)
    {
        if (date >= today) return "incomplete";
        if (status is "fasting" or "not_logged") return status;
        return hasFood ? "complete" : "incomplete";
    }
}
