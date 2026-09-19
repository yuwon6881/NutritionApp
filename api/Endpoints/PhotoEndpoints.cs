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
        app.MapGet("/api/photos/{id:guid}/content",async(HttpContext http,Guid id,PhotoService photos,CancellationToken ct)=>
        {
            var content=await photos.ContentWithMetadata(id,ct);
            var etag=content.Generation is null?null:$"\"gcs:{content.Generation}\"";
            http.Response.Headers.CacheControl="private, max-age=0, must-revalidate";
            if(etag is not null&&http.Request.Headers.IfNoneMatch==etag){http.Response.Headers.ETag=etag;return Results.StatusCode(StatusCodes.Status304NotModified);}
            if(etag is not null)http.Response.Headers.ETag=etag;
            return Results.File(content.Bytes,"image/jpeg");
        });
        app.MapPost("/api/photos/{id:guid}/delete",async(Guid id,PhotoService photos,CancellationToken ct)=>{await photos.Delete(id,ct);return Results.NoContent();});
    }
}
