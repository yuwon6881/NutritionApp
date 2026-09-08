using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
namespace Nutrition.Api.Services;

public sealed class RetentionService(AppDb db,IConfiguration config)
{
    public int DetailDays => Math.Clamp(config.GetValue("Retention:MealDetailDays",7),3,90);
    public static DateOnly Cutoff(DateOnly today,int days) => today.AddDays(1-days);
    public static DateOnly Today(string? profileJson)
    {
        var zone=string.IsNullOrEmpty(profileJson)?"Asia/Kuala_Lumpur":Json.Read<Profile>(profileJson).TimeZone;
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow,TimeZoneInfo.FindSystemTimeZoneById(zone)));
    }
    public void RequireEditable(DateOnly date,string profileJson) => Validation.Require(date>=Cutoff(Today(profileJson),DetailDays),$"Meal details older than {DetailDays} days are summarized and read-only. This unsynced edit is retained locally for review.",409);

    public async Task<int> CompactUser(Guid userId,DateOnly today,CancellationToken ct)
    {
        db.CurrentUser=userId;
        await using var gate=await MutationLock.Acquire(db,userId,ct);
        var cutoff=Cutoff(today,DetailDays);
        var dates=await db.Entries.Where(e=>e.Date<cutoff).Select(e=>e.Date)
            .Union(db.Days.Where(d=>d.Date<cutoff&&!d.Archived).Select(d=>d.Date)).Distinct().OrderBy(d=>d).Take(120).ToListAsync(ct);
        var removed=0;var user=await db.Users.SingleAsync(u=>u.Id==userId,ct);
        foreach(var date in dates)
        {
            var day=await db.Days.SingleOrDefaultAsync(d=>d.Date==date,ct);
            // Already-archived dates cannot acquire new detail through the mutation API.
            if(day?.Archived==true) continue;
            var entries=await db.Entries.Where(e=>e.Date==date&&!e.Deleted).ToListAsync(ct);
            if(day==null){day=new DayStatus { Id=Guid.NewGuid(),UserId=userId,Date=date };db.Days.Add(day);}
            double? Sum(Func<DiaryEntry,double?> select)=>entries.Any(e=>select(e)==null)?null:entries.Sum(e=>select(e)??0);
            day.Calories=entries.Sum(e=>e.Calories);day.Protein=Sum(e=>e.Protein);day.Fat=Sum(e=>e.Fat);day.Carbs=Sum(e=>e.Carbs);day.Fiber=Sum(e=>e.Fiber);
            day.EntryCount=entries.Count;day.Archived=true;day.Revision=++user.Revision;
            if(day.Deleted){day.Deleted=false;day.Status="incomplete";}
            await db.SaveChangesAsync(ct);
            removed+=await db.Entries.Where(e=>e.Date==date).ExecuteDeleteAsync(ct);
        }
        // Old receipts are safe to drop: expired detail writes fail before they can recreate rows.
        // Existing persistent entities still reject replay through their revision checks.
        await db.Receipts.Where(r=>r.Created<DateTime.UtcNow.AddDays(-90)).ExecuteDeleteAsync(ct);
        await gate.Commit(ct);return removed;
    }
    public async Task<int> CompactAll(CancellationToken ct)
    {
        var users=await db.Users.AsNoTracking().Select(u=>new {u.Id,u.ProfileJson}).ToListAsync(ct);var total=0;
        foreach(var user in users){total+=await CompactUser(user.Id,Today(user.ProfileJson),ct);db.ChangeTracker.Clear();}
        return total;
    }
}
