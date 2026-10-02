using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;

namespace Nutrition.Api.Endpoints;

public static class BodyRecordEndpoints
{
    public static void MapBodyRecords(this WebApplication app)
    {
        app.MapGet("/api/body-records",async(BodyRecordService body,string? cursor,bool? photosOnly,CancellationToken ct)
            =>Results.Ok(await body.Page(cursor,photosOnly??false,ct)));
        app.MapGet("/api/body-records/weight-context",async(BodyRecordService body,DateOnly date,CancellationToken ct)
            =>Results.Ok(await body.Capture(date,ct)));
        // A paid provider call: shares the scan rate limit and the daily AI allowance.
        app.MapPost("/api/body-records/body-fat-estimate",async(BodyFatEstimateInput input,BodyFatEstimateService estimates,CancellationToken ct)
            =>Results.Ok(await estimates.Estimate(input,ct))).RequireRateLimiting("scans");
        app.MapGet("/api/body-records/{id:guid}",async(Guid id,BodyRecordService body,CancellationToken ct)
            =>Results.Ok(await body.Detail(id,ct)));
        app.MapPost("/api/body-records/{id:guid}",async(Guid id,BodyMutation input,BodyRecordService body,AppDb db,IServiceScopeFactory scopes,ILogger<BodyRecordService> logger,HttpContext http,CancellationToken ct)=>
        {
            var detail=await body.Apply(id,input,ct);
            // The committed body-fat change owns durable work; capable clients dispatch separately.
            await IntegrationDispatch.AfterCommit(http,
                () => db.GoogleHealthBodyFatSyncWork.AsNoTracking().AnyAsync(work => GoogleHealthSyncLeases.Claimable.Contains(work.ProcessingState), ct),
                () => GoogleHealthOutboundSync.FlushForActiveUserAsync(scopes,db.CurrentUser,logger,ct));
            return Results.Ok(detail);
        });
        app.MapPost("/api/body-records/{id:guid}/photos",async(Guid id,PhotoSetInput input,PhotoService photos,BodyRecordService body,CancellationToken ct)=>
        {
            Validation.Require(id==input.Id&&input.MutationId!=null&&input.ExpectedRevision!=null,"A revisioned photo mutation is required.");
            var uploaded=await photos.Upload(input,ct);
            var record=await body.Detail(id,ct);
            return Results.Ok(new {revision=record.Revision,photos=uploaded});
        });
    }
}
