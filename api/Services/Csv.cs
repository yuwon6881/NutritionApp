using System.Globalization;

namespace Nutrition.Api.Services;

/// <summary>
/// Small RFC 4180 writer shared by the full-history export. Text is guarded
/// against spreadsheet formula execution; generated numeric values are not.
/// </summary>
public static class Csv
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    public static string Field(string? value)
    {
        if (value is null) return "";
        if (value.Length > 0 && "=+-@\t\r".Contains(value[0])) value = "'" + value;
        return Quote(value);
    }

    public static string Field(double? value) => value is { } number && double.IsFinite(number)
        ? number.ToString("R", Invariant)
        : "";

    public static string Field(int? value) => value?.ToString(Invariant) ?? "";
    public static string Field(long? value) => value?.ToString(Invariant) ?? "";
    public static string Field(bool? value) => value is { } flag ? flag ? "true" : "false" : "";
    public static string Field(DateOnly? value) => value?.ToString("yyyy-MM-dd", Invariant) ?? "";

    public static string Field(DateTime? value)
    {
        if (value is not { } dateTime) return "";
        var utc = dateTime.Kind == DateTimeKind.Utc
            ? dateTime
            : dateTime.ToUniversalTime();
        return utc.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", Invariant);
    }

    public static string Field(Guid? value) => value?.ToString("D", Invariant) ?? "";

    public static string Line(params string?[] fields) => string.Join(',', fields.Select(field => field ?? "")) + "\r\n";

    private static string Quote(string value)
    {
        if (!value.Contains(',') && !value.Contains('"') && !value.Contains('\r') && !value.Contains('\n')) return value;
        return '"' + value.Replace("\"", "\"\"", StringComparison.Ordinal) + '"';
    }
}
