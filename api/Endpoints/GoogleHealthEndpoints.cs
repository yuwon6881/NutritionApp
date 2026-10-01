using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Services;

namespace Nutrition.Api.Endpoints;

public static class GoogleHealthEndpoints
{
    public sealed record ConnectInput(bool SyncWeight = false, bool SyncNutrition = false, bool SyncBodyFat = false, bool ImportWeight = false);
    public sealed record SyncInput(bool Force = false, bool? CacheOnly = null);
    public sealed record WeightSyncPreferenceInput(bool Enabled, long Revision);
    public sealed record NutritionSyncPreferenceInput(bool Enabled, long Revision);
    public sealed record BodyFatSyncPreferenceInput(bool Enabled, long Revision);
    public sealed record WeightImportPreferenceInput(bool Enabled, long Revision);

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
                input?.SyncBodyFat == true,
                input?.ImportWeight == true);
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
            IGoogleHealthKms kms, GoogleHealthWeightImportService import, IServiceScopeFactory scopes,
            ILogger<GoogleHealthService> logger, CancellationToken ct) =>
        {
            if (input?.CacheOnly is { } cacheOnly) return Results.Ok(cacheOnly
                ? await GoogleHealthStepReads.ReadCachedAsync(service, db, kms, ct)
                : await GoogleHealthStepReads.RefreshAsync(service, db, kms, ct, input.Force));
            // Older deployed clients lack the separate data request. Keep their upload retry
            // behavior within one deadline until they pick up the new frontend.
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
            deadline.CancelAfter(TimeSpan.FromSeconds(15));
            GoogleHealthSyncResult? steps = null;
            try
            {
                steps = await GoogleHealthStepReads.RefreshAsync(service, db, kms, deadline.Token, input?.Force == true);
                await GoogleHealthActiveDataSync.RunAsync(db, scopes, import, logger, input?.Force == true, deadline.Token);
                return Results.Ok(await service.AttachSyncStatusesAsync(db.CurrentUser!.Value, steps, deadline.Token));
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested && steps is not null) { return Results.Ok(steps); }
        });

        app.MapPost("/api/integrations/google-health/sync-data", async (SyncInput? input, GoogleHealthService service, AppDb db,
            IGoogleHealthKms kms, GoogleHealthWeightImportService weightImport, IServiceScopeFactory scopes,
            ILogger<GoogleHealthService> logger, CancellationToken ct) =>
        {
            await GoogleHealthActiveDataSync.RunAsync(db, scopes, weightImport, logger, input?.Force == true, ct);
            return Results.Ok(await GoogleHealthStepReads.ReadCachedAsync(service, db, kms, ct, includeDays: false));
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

        app.MapPost("/api/integrations/google-health/weight-import/preference", async (WeightImportPreferenceInput input, GoogleHealthWeightImportService service, CancellationToken ct) =>
            Results.Ok(await service.SetPreferenceAsync(input.Enabled, input.Revision, ct)));

        app.MapPost("/api/integrations/google-health/body-fat-sync/preference", async (BodyFatSyncPreferenceInput input, GoogleHealthBodyFatSyncService service, CancellationToken ct) =>
            Results.Ok(await service.SetPreferenceAsync(input.Enabled, input.Revision, ct)));

        app.MapPost("/api/integrations/google-health/body-fat-sync/recover", async (GoogleHealthBodyFatSyncRecoveryInput input, GoogleHealthBodyFatSyncService service, CancellationToken ct) =>
            Results.Ok(await service.RecoverAsync(input.BodyRecordId, ct)));

        // The single scheduled sweep for all outbound queues. Active users are served by the
        // separate data sync above and the flush after each save; this sweep is only a backstop.
        app.MapPost("/internal/google-health-sync", async (IServiceScopeFactory scopes, CancellationToken ct) =>
            Results.Ok(await GoogleHealthOutboundSync.RunAsync(scopes, null, null, ct)));
    }
}
