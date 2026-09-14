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
            TrainingContextService training, AppDb db, CancellationToken ct) =>
        {
            var token = await tokens.Require(httpContext, TrainingScope, ct);
            var user = await db.Users.SingleOrDefaultAsync(u => u.IdentitySubject == token.Subject, ct);
            Validation.Require(user is not null, "That shared account is not mapped to this Nutrition account.", 403);
            db.CurrentUser = user!.Id;
            return Results.Ok(await training.Get(token.Subject, ct));
        });

        app.MapGet("/api/integrations/connected", async (AppDb db, CancellationToken ct) =>
        {
            var rows = await db.IntegrationGrants.AsNoTracking().OrderBy(x => x.Peer).ToListAsync(ct);
            return rows.Select(x => new
            {
                peer = x.Peer, status = x.Status, scopes = JsonSerializer.Deserialize<List<string>>(x.ScopesJson, Json.Options) ?? new List<string>(),
                grantedAt = x.GrantedAt, revokedAt = x.RevokedAt
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
