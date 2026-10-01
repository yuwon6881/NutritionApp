using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Nutrition.Api.Services;

// One weight data point as Google Health reports it. A reading without a UTC offset cannot be placed on
// the user's local day by itself, so the import falls back to the profile time zone for it.
public sealed record GoogleHealthWeightReading(
    string ResourceName,
    DateTimeOffset PhysicalTime,
    TimeSpan? UtcOffset,
    double WeightGrams,
    string? WebClientId);

internal static class GoogleHealthWeightReadProvider
{
    private const string ListUrl = "https://health.googleapis.com/v4/users/me/dataTypes/weight/dataPoints";
    private const int PageSize = 1000;
    // A 31-day window is a few dozen readings for a real scale; the cap only bounds a misbehaving source.
    private const int MaxPages = 5;

    public static async Task<IReadOnlyList<GoogleHealthWeightReading>> ListAsync(
        HttpClient http, string token, DateTimeOffset fromInclusive, DateTimeOffset toExclusive, CancellationToken ct)
    {
        var filter = $"weight.sample_time.physical_time >= \"{Rfc3339(fromInclusive)}\" AND weight.sample_time.physical_time < \"{Rfc3339(toExclusive)}\"";
        var readings = new List<GoogleHealthWeightReading>();
        string? pageToken = null;
        for (var page = 0; page < MaxPages; page++)
        {
            var url = $"{ListUrl}?pageSize={PageSize}&filter={Uri.EscapeDataString(filter)}"
                + (pageToken is null ? "" : $"&pageToken={Uri.EscapeDataString(pageToken)}");
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await SendAsync(http, request, ct);
            using var document = await ReadJsonAsync(response, ct);
            readings.AddRange(Parse(document.RootElement, out pageToken));
            if (string.IsNullOrEmpty(pageToken)) break;
        }
        // Selecting the earliest daily sample from an incomplete list would become permanent.
        if (!string.IsNullOrEmpty(pageToken)) throw Unavailable(null);
        return readings;
    }

    public static IReadOnlyList<GoogleHealthWeightReading> Parse(JsonElement root, out string? nextPageToken)
    {
        nextPageToken = root.TryGetProperty("nextPageToken", out var next) && next.ValueKind == JsonValueKind.String
            ? next.GetString()
            : null;
        var readings = new List<GoogleHealthWeightReading>();
        if (!root.TryGetProperty("dataPoints", out var points) || points.ValueKind != JsonValueKind.Array) return readings;
        foreach (var point in points.EnumerateArray())
        {
            // A point missing any required part is skipped rather than guessed at.
            if (TryParsePoint(point) is { } reading) readings.Add(reading);
        }
        return readings;
    }

    private static GoogleHealthWeightReading? TryParsePoint(JsonElement point)
    {
        if (!point.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String) return null;
        if (!point.TryGetProperty("weight", out var weight) || weight.ValueKind != JsonValueKind.Object) return null;
        if (!weight.TryGetProperty("weightGrams", out var grams) || !TryReadNumber(grams, out var weightGrams)) return null;
        if (!weight.TryGetProperty("sampleTime", out var sample) || sample.ValueKind != JsonValueKind.Object) return null;
        if (!sample.TryGetProperty("physicalTime", out var physical) || physical.ValueKind != JsonValueKind.String) return null;
        if (!DateTimeOffset.TryParse(physical.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var physicalTime)) return null;
        var offset = sample.TryGetProperty("utcOffset", out var offsetValue) && offsetValue.ValueKind == JsonValueKind.String
            ? ParseDuration(offsetValue.GetString())
            : null;
        return new GoogleHealthWeightReading(name.GetString()!, physicalTime, offset, weightGrams, WebClientId(point));
    }

    private static string? WebClientId(JsonElement point)
    {
        if (!point.TryGetProperty("dataSource", out var source) || source.ValueKind != JsonValueKind.Object) return null;
        if (!source.TryGetProperty("application", out var application) || application.ValueKind != JsonValueKind.Object) return null;
        foreach (var property in new[] { "googleWebClientId", "webClientId" })
        {
            if (application.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString()))
                return value.GetString();
        }
        return null;
    }

    private static bool TryReadNumber(JsonElement value, out double number)
    {
        number = 0;
        if (value.ValueKind == JsonValueKind.Number) return value.TryGetDouble(out number);
        // Proto JSON may encode 64-bit integers as strings.
        return value.ValueKind == JsonValueKind.String
            && double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out number);
    }

    // Protobuf Duration JSON: decimal seconds with an "s" suffix, for example "28800s" or "-18000s".
    internal static TimeSpan? ParseDuration(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || !value.EndsWith('s')) return null;
        if (!double.TryParse(value[..^1], NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds)) return null;
        if (!double.IsFinite(seconds) || Math.Abs(seconds) > TimeSpan.FromHours(14).TotalSeconds) return null;
        // DateTimeOffset only accepts whole-minute offsets.
        return TimeSpan.FromMinutes(Math.Round(seconds / 60));
    }

    private static string Rfc3339(DateTimeOffset value)
        => value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);

    private static async Task<HttpResponseMessage> SendAsync(HttpClient http, HttpRequestMessage request, CancellationToken ct)
    {
        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, ct);
        }
        catch (HttpRequestException)
        {
            throw Unavailable(null);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            throw Unavailable(null);
        }
        if (response.IsSuccessStatusCode) return response;
        var status = response.StatusCode;
        var retryAfter = response.Headers.RetryAfter?.Delta;
        response.Dispose();
        throw status switch
        {
            HttpStatusCode.Unauthorized => new GoogleHealthWeightProviderException(
                "reconnect_required", "Reconnect Google Health to resume importing weigh-ins.", authenticationFailure: true),
            HttpStatusCode.Forbidden => new GoogleHealthWeightProviderException(
                "permissions_missing", "Google Health did not grant permission to read weight. Reconnect and allow it."),
            HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests or HttpStatusCode.InternalServerError
                or HttpStatusCode.BadGateway or HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout => Unavailable(retryAfter),
            _ => new GoogleHealthWeightProviderException(
                "provider_request_rejected", "Google Health rejected the weigh-in request.")
        };
    }

    private static async Task<JsonDocument> ReadJsonAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            return JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        }
        catch (JsonException)
        {
            throw Unavailable(null);
        }
    }

    private static GoogleHealthWeightProviderException Unavailable(TimeSpan? retryAfter)
        => new("provider_unavailable", "Google Health is temporarily unavailable. Weigh-ins will import on the next sync.", transient: true, retryAfter: retryAfter);
}
