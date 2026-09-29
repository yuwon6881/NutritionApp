using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services.FoodLookup;

/// <summary>
/// Durable, account-independent product cache. Rows hold only public provider data and can be
/// rebuilt when they expire; the storage sweep keeps the table bounded. Search providers run in
/// parallel over one request's DbContext, which is not thread-safe, so every access is serialized.
/// </summary>
public sealed class PublicFoodCache(AppDb db)
{
    private readonly SemaphoreSlim sync=new(1);

    public async Task<IReadOnlyDictionary<string,FoodResult>> Read(string providerId,IReadOnlyCollection<string> codes,CancellationToken ct)
    {
        var found=new Dictionary<string,FoodResult>(StringComparer.Ordinal);
        if(codes.Count==0)return found;
        await sync.WaitAsync(ct);
        try
        {
            var now=DateTime.UtcNow;
            var rows=await db.PublicFoodProducts.AsNoTracking()
                .Where(product=>product.ProviderId==providerId&&codes.Contains(product.Code)&&product.ExpiresAt>now).ToListAsync(ct);
            foreach(var row in rows)
                if(TryRead(row.ResultJson) is { } result)found[row.Code]=result;
            return found;
        }
        finally { sync.Release(); }
    }

    /// <summary>The first unexpired row in barcode-chain order, so a cache hit answers as the chain would.</summary>
    public async Task<FoodResult?> ReadBarcode(IReadOnlyList<string> providerIds,string code,CancellationToken ct)
    {
        await sync.WaitAsync(ct);
        try
        {
            var now=DateTime.UtcNow;
            var rows=await db.PublicFoodProducts.AsNoTracking()
                .Where(product=>product.Code==code&&providerIds.Contains(product.ProviderId)&&product.ExpiresAt>now).ToListAsync(ct);
            var order=providerIds.ToList();
            return rows.OrderBy(row=>order.IndexOf(row.ProviderId))
                .Select(row=>TryRead(row.ResultJson)).FirstOrDefault(result=>result is not null);
        }
        finally { sync.Release(); }
    }

    public async Task Store(string providerId,IEnumerable<FoodResult> results,DateTime expiresAt,CancellationToken ct)
    {
        var rows=results.Where(result=>result.Code is {Length:>0}).ToList();
        if(rows.Count==0)return;
        await sync.WaitAsync(ct);
        try
        {
            var codes=rows.Select(result=>result.Code!).Distinct(StringComparer.Ordinal).ToArray();
            var existing=await db.PublicFoodProducts.Where(product=>product.ProviderId==providerId&&codes.Contains(product.Code)).ToDictionaryAsync(product=>product.Code,StringComparer.Ordinal,ct);
            foreach(var result in rows)
            {
                var code=result.Code!;
                if(!existing.TryGetValue(code,out var row))
                {
                    row=new PublicFoodProduct { ProviderId=providerId,Code=code };
                    db.PublicFoodProducts.Add(row); existing[code]=row;
                }
                row.ResultJson=Json.Write(result); row.ExpiresAt=expiresAt; row.UpdatedAt=DateTime.UtcNow;
            }
            await db.SaveChangesAsync(ct);
        }
        catch(DbUpdateException)
        {
            // Two instances can hydrate the same public product. The unique key is the
            // coordination boundary; a losing cache write must never make a lookup fail.
            foreach(var entry in db.ChangeTracker.Entries<PublicFoodProduct>())entry.State=EntityState.Detached;
        }
        finally { sync.Release(); }
    }

    private static FoodResult? TryRead(string json)
    {
        try { return Json.Read<FoodResult>(json); }
        catch(JsonException) { return null; }
        catch(DomainException) { return null; }
    }
}
