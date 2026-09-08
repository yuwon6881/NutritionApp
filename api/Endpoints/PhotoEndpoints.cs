using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
namespace Nutrition.Api.Endpoints;
public static class PhotoEndpoints
{
    public static void MapPhotos(this WebApplication app)
    {
        app.MapGet("/api/photos",async(AppDb db,GcsPhotoStore store,IConfiguration config,int? skip,CancellationToken ct)=>new {
            configured=store.Configured,
            usedBytes=await db.Photos.Where(p=>!p.Deleted).SumAsync(p=>(long)p.Bytes,ct),maxBytes=config.GetValue("Physique:MaxBytesPerUser",268435456L),
            photos=(await db.Photos.Where(p=>!p.Deleted&&p.Status=="complete").OrderByDescending(p=>p.Date).ThenBy(p=>p.Id).Skip(Math.Clamp(skip??0,0,100000)).Take(24).ToListAsync(ct)).Select(PhotoService.View)
        });
        app.MapPost("/api/photos",async(PhotoInput input,PhotoService photos,CancellationToken ct)=>await photos.Upload(input,ct));
        app.MapGet("/api/photos/{id:guid}/content",async(Guid id,PhotoService photos,CancellationToken ct)=>Results.File(await photos.Content(id,ct),"image/jpeg"));
        app.MapPost("/api/photos/{id:guid}/delete",async(Guid id,PhotoService photos,CancellationToken ct)=>{await photos.Delete(id,ct);return Results.NoContent();});
    }
}
