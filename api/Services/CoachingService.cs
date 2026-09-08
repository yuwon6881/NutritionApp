using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public record CoachingPreview(long Revision, CoachResult Result, bool CanAccept, string? HoldReason);
public sealed class CoachingService(AppDb db)
{
    public async Task<CoachingPreview> Preview(CancellationToken ct)
    {
        var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
        Validation.Require(user.ProfileJson.Length > 0, "Complete your coaching profile first.");
        var profile = Json.Read<Profile>(user.ProfileJson);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(profile.TimeZone)));
        var since = today.AddDays(-28);
        var statuses = await db.Days.Where(d => d.Date >= since && d.Date < today && !d.Deleted).ToListAsync(ct);
        var totals = await db.Entries.Where(e => e.Date >= since && e.Date < today && !e.Deleted).GroupBy(e => e.Date).Select(g => new { Date=g.Key, Calories=g.Sum(e => e.Calories) }).ToDictionaryAsync(x=>x.Date,x=>x.Calories,ct);
        var days = statuses.Select(d => new NutritionDay(d.Date,d.Status,d.Archived?d.Calories:totals.GetValueOrDefault(d.Date))).ToList();
        var weights = await db.Weights.Where(w => w.Date >= since.AddDays(-56) && w.Date <= today && !w.Deleted).OrderBy(w => w.Date).Select(w => new WeightPoint(w.Date,w.Kg)).ToListAsync(ct);
        var last = await db.Plans.OrderByDescending(p => p.Revision).FirstOrDefaultAsync(ct);
        var accepted = last == null ? null : Json.Read<CoachResult>(last.ResultJson);
        var previous = last?.ProfileRevision == user.ProfileRevision ? accepted : null;
        var seed = last != null && previous == null ? GoalPolicy.CarryExpenditure(Json.Read<Profile>(last.ProfileJson),profile,accepted?.Expenditure) : null;
        var adaptationDue = last == null || today.DayNumber-last.Date.DayNumber >= 7;
        var result = Coach.Calculate(profile,days,weights,previous?.Calories is {} calories && previous.Expenditure is {} exp ? new(calories,exp,previous.PhaseComplete) : null,today,seed,adaptationDue);
        var due = last == null || last.ProfileRevision != user.ProfileRevision || today.DayNumber-last.Date.DayNumber >= 7 || (result.PhaseComplete && accepted?.PhaseComplete != true);
        return new(user.Revision,result,result.Eligible && due,due ? null : $"Your next check-in is available on {last!.Date.AddDays(7):yyyy-MM-dd}.");
    }
    public async Task<AcceptedPlan> Accept(Guid id,long inputRevision,CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db,db.CurrentUser,ct);
        var duplicate = await db.Plans.SingleOrDefaultAsync(p => p.Id == id,ct);
        if(duplicate != null) { Validation.Require(duplicate.InputRevision == inputRevision,"Acceptance identity was reused.",409); return duplicate; }
        var preview = await Preview(ct);
        Validation.Require(preview.Revision == inputRevision,"Your data changed. Refresh this proposal before accepting.",409);
        Validation.Require(preview.CanAccept,preview.HoldReason ?? preview.Result.Explanation,409);
        var user=await db.Users.SingleAsync(u=>u.Id==db.CurrentUser,ct);
        var profile=Json.Read<Profile>(user.ProfileJson);
        var today=DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow,TimeZoneInfo.FindSystemTimeZoneById(profile.TimeZone)));
        var plan=new AcceptedPlan { Id=id,UserId=user.Id,Revision=++user.Revision,Date=today,InputRevision=inputRevision,ProfileRevision=user.ProfileRevision,ResultJson=Json.Write(preview.Result),ProfileJson=user.ProfileJson };
        db.Plans.Add(plan); await db.SaveChangesAsync(ct); await gate.Commit(ct); return plan;
    }
}
