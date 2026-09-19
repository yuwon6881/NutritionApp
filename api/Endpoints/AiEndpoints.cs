using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
namespace Nutrition.Api.Endpoints;
public static class AiEndpoints
{
    public static void MapAi(this WebApplication app)
    {
        app.MapGet("/api/foods/search",async(string q,FoodSearchService foods,AppDb db,CancellationToken ct)=>await foods.Search(q,db,ct));
        app.MapGet("/api/foods/barcode/{code}",async(string code,FoodSearchService foods,AppDb db,CancellationToken ct)=>await foods.Barcode(code,db,ct));
        app.MapPost("/api/scans",async(ScanInput input,ScanService scans,CancellationToken ct)=>await scans.Create(input,ct));
        app.MapPost("/api/scans/{id:guid}/process",async(Guid id,ScanService scans,CancellationToken ct)=>await scans.Process(id,ct));
        app.MapGet("/api/scans/{id:guid}",async(Guid id,AppDb db,CancellationToken ct)=>await db.Scans.SingleOrDefaultAsync(s=>s.Id==id,ct) is {} scan?Results.Ok(scan):Results.NotFound());
        app.MapGet("/api/storage",async(StorageService storage,CancellationToken ct)=>await storage.Overview(ct));
        // Photo cleanup must run before database tombstone purging. It keeps the
        // object path as a durable retry marker until GCS confirms deletion; the
        // storage sweep may then safely remove only already-confirmed rows.
        app.MapPost("/internal/cleanup",async(StorageService storage,RetentionService retention,PhotoService photos,IConfiguration config,CancellationToken ct)=>
        {
            using var budget=new CancellationTokenSource(TimeSpan.FromSeconds(Math.Clamp(config.GetValue("Maintenance:MaxSeconds",45),5,120)));
            using var linked=CancellationTokenSource.CreateLinkedTokenSource(ct,budget.Token);
            var cleanupCt=linked.Token;
            var deletedPhotos=await photos.Cleanup(cleanupCt);
            var deleted=await storage.Cleanup(cleanupCt);
            var compactedEntries=await retention.CompactAll(cleanupCt);
            return new { deleted,compactedEntries,deletedPhotos };
        });
    }
}
