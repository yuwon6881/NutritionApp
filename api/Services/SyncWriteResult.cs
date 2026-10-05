using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
namespace Nutrition.Api.Services;
public sealed record SyncWriteResult(long Revision,IReadOnlyList<DayStatus>? Days=null,IReadOnlyList<Weight>? Weights=null);
public static class SyncWriteResults
{
    // Called inside the account transaction after flushing the changed rows.
    public static async Task<SyncWriteResult> Capture(AppDb db,Mutation mutation,long revision,CancellationToken ct){
        var date=mutation.Data.ValueKind==JsonValueKind.Object&&mutation.Data.TryGetProperty("date",out var value)&&value.ValueKind==JsonValueKind.String
            ?value.Deserialize<DateOnly>(): (DateOnly?)null;
        var days=mutation.Kind=="day"?await db.Days.AsNoTracking().Where(d=>d.Id==mutation.RecordId||d.Date==date).ToListAsync(ct):null;
        var weights=mutation.Kind is "weight" or "weight_move"
            ?await db.Weights.AsNoTracking().Where(w=>w.Id==mutation.RecordId||w.Date==date).ToListAsync(ct):null;
        return new(revision,days,weights);
    }
    public static async Task<SyncWriteResult> Read(AppDb db,Mutation mutation,long revision,CancellationToken ct){
        var receipt=await db.Receipts.AsNoTracking().SingleAsync(r=>r.Id==mutation.Id,ct);
        return receipt.CanonicalJson is {} json?Json.Read<SyncWriteResult>(json):await Capture(db,mutation,revision,ct);
    }
}
