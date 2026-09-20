using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;

namespace Nutrition.Api.Endpoints;

public static class IntegrationEndpoints
{
    public const string TrainingScope = "nutrition.training_context.read";
    public const string WorkoutScope = "workout.training_summary.read";

    public static void MapIntegrations(this WebApplication app)
    {
        app.MapGet("/api/integrations/v1/training-context", async (HttpContext httpContext, OpenIddictAccessTokenService tokens,
            IntegrationTokenService connections, TrainingContextService training, AppDb db, CancellationToken ct) =>
        {
            var token = await tokens.Require(httpContext, TrainingScope, ct);
            await connections.ValidateIncomingConnection(token, ct);
            var user = await db.Users.SingleOrDefaultAsync(u => u.IdentitySubject == token.Subject, ct);
            Validation.Require(user is not null, "That shared account is not mapped to this Nutrition account.", 403);
            db.CurrentUser = user!.Id;
            return Results.Ok(await training.Get(token.Subject, ct));
        });

        app.MapGet("/api/integrations/connected", async (AppDb db, IntegrationTokenService connections,
            WorkoutSummaryService summaries, CancellationToken ct) =>
        {
            var rows = await db.IntegrationGrants.AsNoTracking().OrderBy(x => x.Peer).ToListAsync(ct);
            var workout = rows.SingleOrDefault(x => x.Peer == "workout");
            var state = await connections.GetConnectionState("workout", ct);
            var warning = state is "temporary_unavailable" or "connected" or "reconnect_required"
                ? await summaries.GetLastError(ct)
                : null;
            if (state == "temporary_unavailable" && warning is null)
                warning = "Workout connection status is temporarily unavailable. Try again later.";
            return Results.Ok(new[]
            {
                new
                {
                    peer = "workout",
                    status = workout?.Status ?? "revoked",
                    connectionState = state,
                    syncWarning = warning,
                    scopes = workout is null ? new List<string>() : JsonSerializer.Deserialize<List<string>>(workout.ScopesJson, Json.Options) ?? new List<string>(),
                    grantedAt = workout?.GrantedAt,
                    revokedAt = workout?.RevokedAt
                }
            });
        });

        app.MapDelete("/api/integrations/connected/{peer}", async (string peer, AppDb db, IntegrationTokenService peerTokens,
            WorkoutSummaryService summaries, CancellationToken ct) =>
        {
            Validation.Require(peer == "workout", "Choose a supported connected app.");
            await peerTokens.RevokeAndPurge(peer, ct);
            await summaries.PurgeEphemeral(ct);
            return Results.NoContent();
        });
    }

}
