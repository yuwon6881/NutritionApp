using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
namespace Nutrition.Api.Endpoints;
public static class AiEndpoints
{
    public static void MapAi(this WebApplication app)
    {
        app.MapGet("/api/foods/search",async(string q,FoodSearchService foods,CancellationToken ct)=>await foods.Search(q,ct));
        app.MapGet("/api/foods/barcode/{code}",async(string code,FoodSearchService foods,CancellationToken ct)=>await foods.Barcode(code,ct));
        app.MapPost("/api/scans",async(ScanInput input,ScanService scans,CancellationToken ct)=>await scans.Create(input,ct));
        app.MapPost("/api/scans/{id:guid}/process",async(Guid id,ScanService scans,CancellationToken ct)=>await scans.Process(id,ct));
        app.MapGet("/api/scans/{id:guid}",async(Guid id,AppDb db,CancellationToken ct)=>await db.Scans.SingleOrDefaultAsync(s=>s.Id==id,ct) is {} scan?Results.Ok(scan):Results.NotFound());
        app.MapGet("/api/storage",async(StorageService storage,CancellationToken ct)=>await storage.Overview(ct));
        app.MapPost("/internal/cleanup",async(StorageService storage,RetentionService retention,PhotoService photos,CancellationToken ct)=>new { deleted=await storage.Cleanup(ct),compactedEntries=await retention.CompactAll(ct),deletedPhotos=await photos.Cleanup(ct) });
    }
}
