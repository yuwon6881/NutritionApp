using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
namespace Nutrition.Api.Endpoints;
public static class PhotoEndpoints
{
    public static void MapPhotos(this WebApplication app)
    {
        app.MapGet("/api/photos",async(PhotoService photos,string? cursor,int? limit,int? skip,CancellationToken ct)=>
            skip is not null
                ?Results.Ok(await photos.LegacyPage(skip.Value,ct))
                :Results.Ok(await photos.Page(cursor,limit??20,ct)));
        app.MapPost("/api/photos",async(PhotoSetInput input,PhotoService photos,CancellationToken ct)=>Results.Ok(await photos.Upload(input,ct)));
        app.MapGet("/api/photos/{id:guid}/content",async(Guid id,PhotoService photos,CancellationToken ct)=>Results.File(await photos.Content(id,ct),"image/jpeg"));
        app.MapPost("/api/photos/{id:guid}/delete",async(Guid id,PhotoService photos,CancellationToken ct)=>{await photos.Delete(id,ct);return Results.NoContent();});
    }
}
