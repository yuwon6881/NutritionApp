using Nutrition.Api.Domain;
namespace Nutrition.Api.Services;

/// <summary>The account's local calendar day, resolved from its profile time zone.</summary>
public static class ProfileClock
{
    private const string DefaultZone="Asia/Kuala_Lumpur";
    /// An unknown or corrupt zone id must not abort a whole maintenance or notification pass, so it falls back to the app default.
    public static TimeZoneInfo ResolveZone(string? id)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(string.IsNullOrWhiteSpace(id)?DefaultZone:id); }
        catch(Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { return TimeZoneInfo.FindSystemTimeZoneById(DefaultZone); }
    }
    public static DateOnly Today(string? profileJson)
    {
        var zone=string.IsNullOrEmpty(profileJson)?DefaultZone:Json.Read<Profile>(profileJson).TimeZone;
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow,ResolveZone(zone)));
    }
}
