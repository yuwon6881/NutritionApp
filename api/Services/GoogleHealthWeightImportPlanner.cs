namespace Nutrition.Api.Services;

public sealed record GoogleHealthWeightImportCandidate(DateOnly Date, double Kg, string ResourceName);

// Decides which Google Health readings become NutritionApp weigh-ins. Only days that have never held a
// weigh-in are filled: a saved row wins, and a deleted row is the user's decision for that day.
public static class GoogleHealthWeightImportPlanner
{
    // Today plus the 30 days before it, matching the step history window.
    public const int LookbackDays = 30;
    private const double MinimumKg = 20;
    private const double MaximumKg = 400;

    public static IReadOnlyList<GoogleHealthWeightImportCandidate> Plan(
        IEnumerable<GoogleHealthWeightReading> readings,
        DateOnly today,
        TimeZoneInfo profileZone,
        IReadOnlySet<DateOnly> occupiedDates,
        IReadOnlySet<string> uploadedResourceNames,
        string? ownWebClientId)
    {
        var start = today.AddDays(-LookbackDays);
        return readings
            .Where(reading => !uploadedResourceNames.Contains(reading.ResourceName))
            .Where(reading => string.IsNullOrEmpty(ownWebClientId) || !string.Equals(reading.WebClientId, ownWebClientId, StringComparison.Ordinal))
            .Select(reading => (Reading: reading, Local: LocalTime(reading, profileZone), Kg: Math.Round(reading.WeightGrams / 1000, 3)))
            .Where(item => item.Kg is >= MinimumKg and <= MaximumKg)
            .Select(item => (item.Reading, item.Local, item.Kg, Date: DateOnly.FromDateTime(item.Local.DateTime)))
            .Where(item => item.Date >= start && item.Date <= today && !occupiedDates.Contains(item.Date))
            .GroupBy(item => item.Date)
            // Morning weigh-ins are the convention the trend assumes, so the earliest reading represents the day.
            .Select(day => day
                .OrderBy(item => item.Reading.PhysicalTime)
                .ThenBy(item => item.Reading.ResourceName, StringComparer.Ordinal)
                .First())
            .OrderBy(item => item.Date)
            .Select(item => new GoogleHealthWeightImportCandidate(item.Date, item.Kg, item.Reading.ResourceName))
            .ToList();
    }

    private static DateTimeOffset LocalTime(GoogleHealthWeightReading reading, TimeZoneInfo profileZone)
        => reading.UtcOffset is { } offset
            ? reading.PhysicalTime.ToOffset(offset)
            : TimeZoneInfo.ConvertTime(reading.PhysicalTime, profileZone);
}
