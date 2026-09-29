using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

/// One AI allowance for every paid provider call: the per-account daily request cap and the
/// optional monthly budget are shared by food scans and body-fat estimates.
public static class AiAllowance
{
    /// Counts one request against today's allowance. The caller must hold the global
    /// MutationLock (user null) because the monthly budget spans every account.
    public static async Task<DateOnly> ReserveUnderLock(AppDb db,IConfiguration config,CancellationToken ct)
    {
        var day=DateOnly.FromDateTime(DateTime.UtcNow);
        var usage=await db.Usage.SingleOrDefaultAsync(u=>u.Date==day,ct)??new AiUsage {UserId=db.CurrentUser!.Value,Date=day};
        Validation.Require(usage.Requests<config.GetValue("OpenAi:DailyRequestsPerUser",20),"Today's AI allowance is used. Manual logging is available.",429);
        var cap=config.GetValue<double?>("OpenAi:MonthlyBudgetUsd");
        if(cap!=null)
        {
            // Reserve worst-case request cost across both users before making a paid call.
            var month=new DateOnly(day.Year,day.Month,1);
            var total=await db.Usage.IgnoreQueryFilters().Where(u=>u.Date>=month).SumAsync(u=>u.Requests,ct);
            Validation.Require((total+1)*config.GetValue("OpenAi:ReservedCostPerRequestUsd",0.25)<=cap,"Monthly AI allowance is used.",429);
        }
        if(db.Entry(usage).State==EntityState.Detached)db.Usage.Add(usage);
        usage.Requests++;
        return day;
    }

    /// Reserves and commits one request in its own transaction.
    public static async Task<DateOnly> Reserve(AppDb db,IConfiguration config,CancellationToken ct)
    {
        await using var gate=await MutationLock.Acquire(db,null,ct);
        var day=await ReserveUnderLock(db,config,ct);
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
