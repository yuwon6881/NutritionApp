using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
namespace Nutrition.Api.Services;
internal static class GoogleHealthBodyFatMapping
{
    public static async Task RepairProvable(AppDb db,BodyRecord? before,CancellationToken ct){
        var orphaned=await db.GoogleHealthBodyFatSyncWork.Where(w=>!db.BodyRecords.Any(b=>b.Id==w.BodyRecordId)).ToListAsync(ct);
        foreach(var work in orphaned){
            var receipt=await db.Receipts.SingleOrDefaultAsync(r=>r.Id==work.BodyRecordId&&r.Revision==work.DesiredRevision,ct);
            if(receipt==null)continue;
            var record=before?.Revision==work.DesiredRevision?before:
                await db.BodyRecords.SingleOrDefaultAsync(b=>b.Revision==work.DesiredRevision,ct);
            if(record==null||record.Date!=work.DesiredDate||record.Measurements.BodyFatPercent!=work.DesiredBodyFatPercent)continue;
            if(await db.GoogleHealthBodyFatSyncWork.AnyAsync(w=>w.BodyRecordId==record.Id,ct))continue;
            work.BodyRecordId=record.Id;
        }
    }
}
