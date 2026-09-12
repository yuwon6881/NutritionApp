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
        app.MapGet("/api/body-records/{id:guid}",async(Guid id,BodyRecordService body,CancellationToken ct)
            =>Results.Ok(await body.Detail(id,ct)));
        app.MapPost("/api/body-records/{id:guid}",async(Guid id,BodyMutation input,BodyRecordService body,CancellationToken ct)
            =>Results.Ok(await body.Apply(id,input,ct)));
        app.MapPost("/api/body-records/{id:guid}/photos",async(Guid id,PhotoSetInput input,PhotoService photos,BodyRecordService body,CancellationToken ct)=>
        {
            Validation.Require(id==input.Id&&input.MutationId!=null&&input.ExpectedRevision!=null,"A revisioned photo mutation is required.");
            var uploaded=await photos.Upload(input,ct);
            var record=await body.Detail(id,ct);
            return Results.Ok(new {revision=record.Revision,photos=uploaded});
        });
    }
}
