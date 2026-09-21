using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace Nutrition.Api.Endpoints;

public sealed record NutritionCheckInReminderInput(bool Enabled, int Weekday, string LocalTime, string TimeZoneId);
public sealed record NutritionPushSubscriptionInput(string DeviceId, string FcmToken);
public sealed record NutritionPushUnsubscribeInput(string FcmToken);

public static class NutritionNotificationEndpoints
{
    public static void MapNutritionNotifications(this WebApplication app)
    {
        app.MapGet("/api/notifications/status", async (string? deviceId, NutritionNotificationService notifications, CancellationToken ct) =>
        {
            Validation.Require(deviceId is null || deviceId.Length <= 200, "The device id is too long.");
            return Results.Ok(await notifications.GetStatusAsync(deviceId, ct));
        });

        app.MapGet("/api/notifications/check-in-reminder", async (NutritionNotificationService notifications, CancellationToken ct) =>
            Results.Ok(await notifications.GetSettingsAsync(ct)));

        app.MapPost("/api/notifications/check-in-reminder", async (
            NutritionCheckInReminderInput input,
            NutritionNotificationService notifications,
            CancellationToken ct) =>
        {
            var result = await notifications.SetSettingsAsync(input.Enabled, input.Weekday, input.LocalTime, input.TimeZoneId, ct);
            return Results.Ok(result);
        });

        app.MapPost("/api/notifications/subscriptions", async (
            NutritionPushSubscriptionInput input,
            NutritionNotificationService notifications,
            CancellationToken ct) =>
        {
            await notifications.RegisterDeviceAsync(input.DeviceId, input.FcmToken, ct);
            return Results.Ok(new { subscribed = true });
        });

        app.MapDelete("/api/notifications/subscriptions/{deviceId}", async (
            string deviceId,
            [FromBody] NutritionPushUnsubscribeInput input,
            NutritionNotificationService notifications,
            CancellationToken ct) =>
        {
            Validation.Require(deviceId.Length <= 200, "The device id is too long.");
            Validation.Require(!string.IsNullOrWhiteSpace(input.FcmToken) && input.FcmToken.Length <= 4096, "A valid notification token is required.");
            await notifications.UnsubscribeDeviceAsync(deviceId, input.FcmToken, ct);
            return Results.NoContent();
        });

        app.MapPost("/internal/nutrition-check-in-dispatch", async (
            NutritionNotificationService notifications,
            INutritionPushSender sender,
            ILogger<NutritionNotificationService> logger,
            CancellationToken ct) =>
        {
            var result = await notifications.DispatchDueAsync(sender, logger, ct);
            if (!result.Configured) return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
            return Results.Ok(result);
        });
    }
}
