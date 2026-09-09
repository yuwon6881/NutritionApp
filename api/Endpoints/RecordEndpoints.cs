using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;

namespace Nutrition.Api.Endpoints;
public record AcceptInput(Guid Id,long Revision);
public record GoalDecisionInput(Guid Id,long Revision,string Decision);
public static class RecordEndpoints
{
    public static void MapRecords(this WebApplication app)
    {
        app.MapGet("/api/state",async(AppDb db,RetentionService retention,ExpenditureTrajectoryService trajectory,DateOnly? date,int? year,CancellationToken ct) =>
        {
            var user=await db.Users.SingleAsync(u=>u.Id==db.CurrentUser,ct);
            var snapshots=await trajectory.EnsureThroughToday(ct);
            var today=RetentionService.Today(user.ProfileJson);
            Validation.Require(date==null || date>=new DateOnly(2000,1,1)&&date<=today,"Choose a supported diary date.");
            var end=date??today; var start=end.AddDays(-89);
            if(year is {} y){Validation.Require(y>=2000&&y<=today.Year,"Choose a supported history year.");start=new(y,1,1);end=new(y,12,31);}
            var energySnapshots=snapshots.Where(snapshot=>snapshot.Date>=start&&snapshot.Date<=end).ToList();
            var precedingSnapshot=snapshots.Where(snapshot=>snapshot.Date<start).OrderByDescending(snapshot=>snapshot.Date).FirstOrDefault();
            if(precedingSnapshot!=null)energySnapshots.Insert(0,precedingSnapshot);
            var orderedPlans=await db.Plans.OrderBy(plan=>plan.Date).ThenBy(plan=>plan.Revision).ToListAsync(ct);
            var acceptedTargetIntervals=orderedPlans.Select((plan,index)=>
            {
                var result=Json.Read<CoachResult>(plan.ResultJson);
                var next=index+1<orderedPlans.Count?orderedPlans[index+1].Date.AddDays(-1):today;
                return new { start=plan.Date,end=next,calories=result.Calories,weeklyCalories=result.WeeklyCalories,dailyCalories=result.DailyCalories };
            }).Where(interval=>interval.end>=interval.start).ToList();
            return Results.Ok(new {
                user.Id,user.Username,user.Revision,user.ProfileRevision,
                settings=new { checkInWeekday=user.CheckInWeekday,revision=user.CoachingSettingsRevision,changedDate=user.CoachingSettingsChangedDate },
                profile=user.ProfileJson.Length==0?null:Json.Read<Profile>(user.ProfileJson), start,end,
                detailCutoff=RetentionService.Cutoff(RetentionService.Today(user.ProfileJson),retention.DetailDays),detailDays=retention.DetailDays,
                energyEstimates=energySnapshots.Select(snapshot=>new { date=snapshot.Date,revision=snapshot.SourceRevision,expenditure=snapshot.Expenditure,suggestedCalories=snapshot.SuggestedCalories,confidence=snapshot.Confidence,holdReason=snapshot.HoldReason,algorithmVersion=snapshot.AlgorithmVersion,trendWeightKg=snapshot.TrendWeightKg }),
                acceptedTargetIntervals,
                entries=await db.Entries.Where(e=>e.Date>=start&&e.Date<=end).OrderBy(e=>e.Date).ThenBy(e=>e.Id).ToListAsync(ct),
                foods=await db.Foods.OrderBy(f=>f.Name).Take(1000).ToListAsync(ct),
                weights=await db.Weights.Where(w=>w.Date>=start&&w.Date<=end).OrderBy(w=>w.Date).ToListAsync(ct),
                weightTrendSeed=await db.Weights.Where(w=>w.Date>=start.AddDays(-56)&&w.Date<start&&!w.Deleted).OrderBy(w=>w.Date).ToListAsync(ct),
                days=await db.Days.Where(d=>d.Date>=start&&d.Date<=end).ToListAsync(ct),
                plans=await db.Plans.OrderByDescending(p=>p.Revision).Take(12).ToListAsync(ct),
                checkIns=await db.CheckIns.OrderByDescending(c=>c.Revision).Take(12).ToListAsync(ct),
                phaseDecisions=await db.PhaseDecisions.OrderByDescending(d=>d.Revision).Take(12).ToListAsync(ct)
            });
        });
        app.MapPost("/api/sync",async(Mutation mutation,SyncService sync,CancellationToken ct)=>Results.Ok(new { revision=await sync.Apply(mutation,ct) }));
        app.MapGet("/api/coach/preview",async(CoachingService coach,CancellationToken ct)=>await coach.Preview(ct));
        app.MapPost("/api/coach/accept",async(AcceptInput input,CoachingService coach,CancellationToken ct)=>await coach.Accept(input.Id,input.Revision,ct));
        app.MapPost("/api/coach/decline",async(AcceptInput input,CoachingService coach,CancellationToken ct)=>await coach.Decline(input.Id,input.Revision,ct));
        app.MapPost("/api/goal/complete",async(GoalDecisionInput input,CoachingService coach,CancellationToken ct)=>await coach.CompleteGoal(input.Id,input.Revision,input.Decision,ct));
        app.MapGet("/api/export",async(AppDb db,CancellationToken ct)=>
        {
            var user=await db.Users.SingleAsync(u=>u.Id==db.CurrentUser,ct);
            var data=new { schemaVersion=1,exportedAt=DateTime.UtcNow,profile=user.ProfileJson,
                entries=await db.Entries.Where(x=>!x.Deleted).ToListAsync(ct),foods=await db.Foods.Where(x=>!x.Deleted).ToListAsync(ct),
                weights=await db.Weights.Where(x=>!x.Deleted).ToListAsync(ct),days=await db.Days.Where(x=>!x.Deleted).ToListAsync(ct),plans=await db.Plans.ToListAsync(ct),
                physiquePhotos=await db.Photos.Where(x=>!x.Deleted&&x.Status=="complete").Select(x=>new { x.Id,x.Date,x.Caption,x.Angle,x.Bytes,downloadPath="/api/photos/"+x.Id+"/content" }).ToListAsync(ct) };
            return Results.File(System.Text.Encoding.UTF8.GetBytes(Json.Write(data)),"application/json","nutrition-export.json");
        });
    }
}
