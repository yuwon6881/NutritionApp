using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Nutrition.Api.Services;

public sealed record GoogleHealthNutritionDataPoint(
    string StartTime,
    string EndTime,
    string FoodDisplayName,
    string MealType,
    double CaloriesKcal,
    double? ProteinGrams,
    double? FatGrams,
    double? CarbsGrams,
    double? FiberGrams);

internal sealed class GoogleHealthNutritionProviderException(
    string category,
    string message,
    bool transient = false,
    bool unknownCreate = false,
    TimeSpan? retryAfter = null,
    bool authenticationFailure = false) : Exception(message)
{
    public string Category { get; } = category;
    public bool Transient { get; } = transient;
    public bool UnknownCreate { get; } = unknownCreate;
    public TimeSpan? RetryAfter { get; } = retryAfter;
    public bool AuthenticationFailure { get; } = authenticationFailure;
}

internal static class GoogleHealthNutritionProvider
{
    public static Task<GoogleHealthOperationResult> CreateAsync(HttpClient http, string token, GoogleHealthNutritionDataPoint data, CancellationToken ct)
        => SendOperationAsync(http, HttpMethod.Post, "https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints", token, BuildPayload(data), true, ct);

    public static Task<GoogleHealthOperationResult> UpdateAsync(HttpClient http, string token, string resourceName, GoogleHealthNutritionDataPoint data, CancellationToken ct)
        => SendOperationAsync(http, HttpMethod.Patch, ResourceUrl(resourceName), token, BuildPayload(data), false, ct);

    public static Task<GoogleHealthOperationResult> DeleteAsync(HttpClient http, string token, string resourceName, CancellationToken ct)
        => SendOperationAsync(http, HttpMethod.Post, "https://health.googleapis.com/v4/users/me/dataTypes/nutrition-log/dataPoints:batchDelete", token, new { names = new[] { resourceName } }, false, ct, deleteRequest: true);

    public static Task<GoogleHealthOperationResult> PollAsync(HttpClient http, string token, string operationName, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, ResourceUrl(operationName));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return PollInternalAsync(http, request, operationName, ct);
    }

    private static async Task<GoogleHealthOperationResult> PollInternalAsync(HttpClient http, HttpRequestMessage request, string operationName, CancellationToken ct)
    {
        using var response = await SendAsync(http, request, false, ct);
        return await ParseOperationAsync(response, operationName, false, ct);
    }

    public static object BuildPayload(GoogleHealthNutritionDataPoint data)
    {
        var nutrients = new List<object>();
        if (data.ProteinGrams is { } p)
            nutrients.Add(new { nutrient = "PROTEIN", quantity = new { grams = Math.Round(p, 2) } });
        if (data.CarbsGrams is { } c)
            nutrients.Add(new { nutrient = "TOTAL_CARBOHYDRATE", quantity = new { grams = Math.Round(c, 2) } });
        if (data.FatGrams is { } f)
            nutrients.Add(new { nutrient = "TOTAL_FAT", quantity = new { grams = Math.Round(f, 2) } });
        if (data.FiberGrams is { } fib)
            nutrients.Add(new { nutrient = "DIETARY_FIBER", quantity = new { grams = Math.Round(fib, 2) } });

        return new
        {
            nutritionLog = new
            {
                interval = new
                {
                    startTime = data.StartTime,
                    endTime = data.EndTime
                },
                foodDisplayName = string.IsNullOrWhiteSpace(data.FoodDisplayName) ? "Food" : data.FoodDisplayName.Trim(),
                mealType = string.IsNullOrWhiteSpace(data.MealType) ? "MEAL_TYPE_UNSPECIFIED" : data.MealType,
                energy = new
                {
                    kcal = Math.Round(data.CaloriesKcal, 1)
                },
                nutrients
            }
        };
    }

    private static async Task<GoogleHealthOperationResult> SendOperationAsync(HttpClient http, HttpMethod method, string url, string token, object body, bool create, CancellationToken ct, bool deleteRequest = false)
    {
        using var request = new HttpRequestMessage(method, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body, Json.Options), Encoding.UTF8, "application/json")
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        try
        {
            using var response = await SendAsync(http, request, create, ct, deleteRequest);
            if (response.StatusCode == HttpStatusCode.NotFound && deleteRequest)
                return new(true, true);
            return await ParseOperationAsync(response, null, create, ct);
        }
        catch (GoogleHealthNutritionProviderException)
        {
            throw;
        }
        catch (HttpRequestException) when (create)
        {
            throw new GoogleHealthNutritionProviderException("upload_status_unknown", "The create response was lost; check Google Health before retrying.", unknownCreate: true);
        }
        catch (JsonException) when (create)
        {
            throw new GoogleHealthNutritionProviderException("upload_status_unknown", "The create response was unreadable; check Google Health before retrying.", unknownCreate: true);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested && create)
        {
            throw new GoogleHealthNutritionProviderException("upload_status_unknown", "The create response was lost; check Google Health before retrying.", unknownCreate: true);
        }
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient http, HttpRequestMessage request, bool create, CancellationToken ct, bool allowMissing = false)
    {
        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, ct);
        }
        catch (HttpRequestException) when (create)
        {
            throw;
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested && create)
        {
            throw;
        }
        if (response.IsSuccessStatusCode || (allowMissing && response.StatusCode == HttpStatusCode.NotFound)) return response;
        var retryAfter = ParseRetryAfter(response.Headers.RetryAfter);
        var transient = response.StatusCode is HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests or HttpStatusCode.BadGateway or HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout or HttpStatusCode.InternalServerError;
        var authentication = response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden;
        var body = await response.Content.ReadAsStringAsync(ct);
        response.Dispose();
        if (authentication) throw new GoogleHealthNutritionProviderException("reconnect_required", "Reconnect Google Health to resume nutrition uploads.", authenticationFailure: true);
        if (transient) throw new GoogleHealthNutritionProviderException("provider_unavailable", "Google Health temporarily rejected the upload.", true, retryAfter: retryAfter);
        throw new GoogleHealthNutritionProviderException("provider_validation", "Google Health rejected this nutrition upload.");
    }

    private static async Task<GoogleHealthOperationResult> ParseOperationAsync(HttpResponseMessage response, string? fallbackName, bool create, CancellationToken ct)
    {
        var json = await response.Content.ReadAsStringAsync(ct);
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var operationName = root.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String ? name.GetString() : fallbackName;
        var done = root.TryGetProperty("done", out var doneValue) && doneValue.ValueKind == JsonValueKind.True;
        if (!done) return new(false, false, operationName);
        if (root.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.Object)
        {
            var category = error.TryGetProperty("status", out var status) ? status.GetString() : "provider_validation";
            var message = error.TryGetProperty("message", out var errorMessage) ? errorMessage.GetString() : "Google Health rejected the operation.";
            var authentication = category is "UNAUTHENTICATED" or "PERMISSION_DENIED";
            var transient = category is "UNAVAILABLE" or "RESOURCE_EXHAUSTED" or "ABORTED" or "DEADLINE_EXCEEDED" or "INTERNAL";
            return new(true, false, operationName, AuthenticationFailure: authentication, Transient: transient, ErrorCategory: category, ErrorMessage: "Google Health rejected this nutrition upload.");
        }
        var resourceName = FindResourceName(root);
        if (create && string.IsNullOrWhiteSpace(resourceName))
            return new(true, false, operationName, UnknownCreate: true, ErrorCategory: "provider_response_invalid", ErrorMessage: "Google Health did not return a resource mapping.");
        return new(true, true, operationName, resourceName);
    }

    private static string? FindResourceName(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String && name.GetString()?.Contains("/dataPoints/", StringComparison.Ordinal) == true)
                return name.GetString();
            foreach (var property in element.EnumerateObject())
            {
                var found = FindResourceName(property.Value);
                if (found is not null) return found;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                var found = FindResourceName(item);
                if (found is not null) return found;
            }
        }
        return null;
    }

    private static string ResourceUrl(string name)
        => name.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? name : $"https://health.googleapis.com/v4/{name.TrimStart('/')}";

    private static TimeSpan? ParseRetryAfter(RetryConditionHeaderValue? header)
    {
        if (header?.Delta is { } delta) return delta;
        if (header?.Date is { } date)
        {
            var delay = date - DateTimeOffset.UtcNow;
            if (delay > TimeSpan.Zero) return delay;
        }
        return null;
    }
}
