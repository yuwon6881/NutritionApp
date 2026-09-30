using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;

namespace Nutrition.Api.Services;

/// One AI allowance for every paid provider call: records request and token accounting
/// shared by food scans and body-fat estimates.
public static class AiAllowance
{
    /// Counts one request against today's usage. The caller must hold the global MutationLock.
    public static async Task<DateOnly> ReserveUnderLock(AppDb db,CancellationToken ct)
    {
        var day=DateOnly.FromDateTime(DateTime.UtcNow);
        var usage=await db.Usage.SingleOrDefaultAsync(u=>u.Date==day,ct)??new AiUsage {UserId=db.CurrentUser!.Value,Date=day};
        if(db.Entry(usage).State==EntityState.Detached)db.Usage.Add(usage);
        usage.Requests++;
        return day;
    }

    /// Reserves and commits one request in its own transaction.
    public static async Task<DateOnly> Reserve(AppDb db,CancellationToken ct)
    {
        await using var gate=await MutationLock.Acquire(db,null,ct);
        var day=await ReserveUnderLock(db,ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return day;
    }

    public static Task RecordTokens(AppDb db,DateOnly day,long inputTokens,long cachedInputTokens,long outputTokens)
        =>db.Usage.Where(u=>u.Date==day).ExecuteUpdateAsync(s=>s
            .SetProperty(u=>u.InputTokens,u=>u.InputTokens+inputTokens)
            .SetProperty(u=>u.CachedInputTokens,u=>u.CachedInputTokens+cachedInputTokens)
            .SetProperty(u=>u.OutputTokens,u=>u.OutputTokens+outputTokens),CancellationToken.None);
}
