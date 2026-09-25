using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Services;

namespace Nutrition.Api.Endpoints;

public static class GoogleHealthEndpoints
{
    public sealed record ConnectInput(bool SyncWeight = false, bool SyncNutrition = false, bool SyncBodyFat = false);
    public sealed record SyncInput(bool Force = false);
    public sealed record WeightSyncPreferenceInput(bool Enabled, long Revision);
    public sealed record NutritionSyncPreferenceInput(bool Enabled, long Revision);
    public sealed record BodyFatSyncPreferenceInput(bool Enabled, long Revision);

    public static void MapGoogleHealth(this WebApplication app)
    {
        app.MapPost("/api/integrations/google-health/connect", async (ConnectInput? input, GoogleHealthService service, AppDb db, HttpContext http, CancellationToken ct) =>
        {
            var token = http.Request.Cookies[AuthService.Cookie];
            var sessionHash = AuthService.Hash(token ?? "");
            var origin = http.Request.Headers.Origin.ToString();
            if (string.IsNullOrEmpty(origin))
                origin = $"{http.Request.Scheme}://{http.Request.Host}";

            var result = await service.GenerateConnectUrlAsync(
                db.CurrentUser!.Value,
                sessionHash,
                origin,
                ct,
                input?.SyncWeight == true,
                input?.SyncNutrition == true,
                input?.SyncBodyFat == true);
            return Results.Ok(result);
        });

        app.MapGet("/api/integrations/google-health/callback", async (
            [FromQuery] string? code,
            [FromQuery] string? state,
            [FromQuery] string? error,
            GoogleHealthService service,
            AppDb db,
            HttpContext http,
            CancellationToken ct) =>
        {
            var token = http.Request.Cookies[AuthService.Cookie];
            if (string.IsNullOrEmpty(token))
                return Results.Redirect("/settings?google_health=error&code=session_expired");

            var sessionHash = AuthService.Hash(token);
            var session = await db.Sessions.AsNoTracking().SingleOrDefaultAsync(s => s.Hash == sessionHash && s.Expires > DateTime.UtcNow, ct);
            if (session == null)
                return Results.Redirect("/settings?google_health=error&code=session_expired");

            db.CurrentUser = session.UserId;
            var origin = $"{http.Request.Scheme}://{http.Request.Host}";
            var redirectUrl = await service.HandleCallbackAsync(code, state, error, session.UserId, sessionHash, origin, ct);
            return Results.Redirect(redirectUrl);
        });

        app.MapPost("/api/integrations/google-health/sync", async (SyncInput? input, GoogleHealthService service, AppDb db,
            IServiceScopeFactory scopes, ILogger<GoogleHealthService> logger, CancellationToken ct) =>
        {
            // The app calls this while its user is active, so their queued uploads go now at no
            // extra wake-up cost. The hourly sweep retries anything this bounded pass leaves.
            try { await GoogleHealthOutboundSync.RunAsync(scopes, db.CurrentUser!.Value, GoogleHealthOutboundSync.ActiveUserBudget, ct); }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                logger.LogWarning("Google Health uploads for an active user were deferred to the scheduled sweep: {FailureType}.", ex.GetType().Name);
            }
            var result = await service.SyncAsync(db.CurrentUser!.Value, ct, input?.Force == true);
            return Results.Ok(result);
        });

        app.MapPost("/api/integrations/google-health/disconnect", async (GoogleHealthService service, AppDb db, CancellationToken ct) =>
        {
            var result = await service.DisconnectAsync(db.CurrentUser!.Value, ct);
            return Results.Ok(result);
        });

        app.MapPost("/api/integrations/google-health/weight-sync/preference", async (WeightSyncPreferenceInput input, GoogleHealthWeightSyncService service, CancellationToken ct) =>
            Results.Ok(await service.SetPreferenceAsync(input.Enabled, input.Revision, ct)));

        app.MapPost("/api/integrations/google-health/weight-sync/recover", async (GoogleHealthWeightSyncRecoveryInput input, GoogleHealthWeightSyncService service, CancellationToken ct) =>
            Results.Ok(await service.RecoverAsync(input.WeightId, ct)));

        app.MapPost("/api/integrations/google-health/nutrition-sync/preference", async (NutritionSyncPreferenceInput input, GoogleHealthNutritionSyncService service, CancellationToken ct) =>
            Results.Ok(await service.SetPreferenceAsync(input.Enabled, input.Revision, ct)));

        app.MapPost("/api/integrations/google-health/nutrition-sync/recover", async (GoogleHealthNutritionSyncRecoveryInput input, GoogleHealthNutritionSyncService service, CancellationToken ct) =>
            Results.Ok(await service.RecoverAsync(input.EntryId, ct)));

        app.MapPost("/api/integrations/google-health/body-fat-sync/preference", async (BodyFatSyncPreferenceInput input, GoogleHealthBodyFatSyncService service, CancellationToken ct) =>
            Results.Ok(await service.SetPreferenceAsync(input.Enabled, input.Revision, ct)));

        app.MapPost("/api/integrations/google-health/body-fat-sync/recover", async (GoogleHealthBodyFatSyncRecoveryInput input, GoogleHealthBodyFatSyncService service, CancellationToken ct) =>
            Results.Ok(await service.RecoverAsync(input.BodyRecordId, ct)));

        // The single scheduled sweep for all outbound queues. Active users are served by the
        // steps sync above, so this runs hourly and lets the API and database scale to zero.
        app.MapPost("/internal/google-health-sync", async (IServiceScopeFactory scopes, CancellationToken ct) =>
            Results.Ok(await GoogleHealthOutboundSync.RunAsync(scopes, null, null, ct)));
    }
}
