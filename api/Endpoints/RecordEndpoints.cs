using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;

namespace Nutrition.Api.Endpoints;
public record AcceptInput(Guid Id,long Revision);
public record GoalDecisionInput(Guid Id,long Revision,string Decision);
internal sealed record AcceptedTargetInterval(DateOnly Start,DateOnly End,double? Calories,double? WeeklyCalories,IReadOnlyList<int>? DailyCalories,double? Protein,double? Carbs,double? Fat,bool? ProteinFixed);
public static class RecordEndpoints
{
    internal static IReadOnlyList<AcceptedTargetInterval> BuildAcceptedTargetIntervals(IReadOnlyList<AcceptedPlan> plans,DateOnly today)
        => plans.Select((plan,index)=>
        {
            var result=Json.Read<CoachResult>(plan.ResultJson);
            var next=index+1<plans.Count?plans[index+1].Date.AddDays(-1):today;
            return new AcceptedTargetInterval(plan.Date,next,result.Calories,result.WeeklyCalories,result.DailyCalories,result.Protein,result.Carbs,result.Fat,result.ProteinFixed);
        }).Where(interval=>interval.End>=interval.Start).ToList();

    public static void MapRecords(this WebApplication app)
    {
        app.MapGet("/api/revisions", async (HttpContext http, AppDb db, RetentionService retention, CancellationToken ct) =>
        {
            var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == db.CurrentUser, ct);
            var training = await db.WorkoutSummaries.AsNoTracking().Select(x => (long?)x.Revision).SingleOrDefaultAsync(ct) ?? 0;
            var google = await db.GoogleHealthConnections.AsNoTracking().Select(x => (long?)x.Revision).SingleOrDefaultAsync(ct) ?? 0;
            var localDay = RetentionService.Today(user.ProfileJson);
            var etag = $"\"revisions:{user.Id:N}:{user.Revision}:{user.ProfileRevision}:{user.CoachingSettingsRevision}:{user.TrajectoryRevision}:{user.FoodRevision}:{user.DiaryRevision}:{user.BodyRevision}:{training}:{google}:{localDay:yyyy-MM-dd}:{retention.DetailDays}\"";
            if (http.Request.Headers.IfNoneMatch == etag)
            {
                http.Response.Headers.ETag = etag;
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }
            http.Response.Headers.ETag = etag;
            return Results.Ok(new
            {
                account = user.Revision,
                profile = user.ProfileRevision,
                settings = user.CoachingSettingsRevision,
                trajectory = user.TrajectoryRevision,
                foods = user.FoodRevision,
                diary = user.DiaryRevision,
                body = user.BodyRevision,
                training,
                google,
                localDay,
                detailDays = retention.DetailDays
            });
        });

        app.MapGet("/api/bootstrap", (HttpContext http, BootstrapReadService read, CancellationToken ct) => read.Get(http, ct));

        app.MapGet("/api/diary", async (HttpContext http, AppDb db, RetentionService retention, DateOnly? from, DateOnly? to, CancellationToken ct) =>
        {
            Validation.Require(from is not null && to is not null, "Specify both 'from' and 'to' dates.");
            var startDate = from!.Value;
            var endDate = to!.Value;
            Validation.Require(startDate <= endDate, "The start date must be before or equal to the end date.");
            Validation.Require(endDate.DayNumber - startDate.DayNumber + 1 <= 31, "Diary range cannot exceed 31 days.");
            var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
            var today = RetentionService.Today(user.ProfileJson);
            Validation.Require(startDate >= new DateOnly(2000, 1, 1) && endDate <= today.AddDays(1), "Choose a supported diary date.");

            // Diary reads depend on diary mutations and the local-day retention boundary. Profile,
            // food, or training changes do not invalidate an unchanged historical range.
            var etag = $"\"diary:{user.Id:N}:{user.DiaryRevision}:{startDate:yyyy-MM-dd}:{endDate:yyyy-MM-dd}:{today:yyyy-MM-dd}:{retention.DetailDays}\"";
            if (http.Request.Headers.IfNoneMatch == etag)
            {
                http.Response.Headers.ETag = etag;
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }

            var entries = await db.Entries.AsNoTracking().Where(e => e.Date >= startDate && e.Date <= endDate).OrderBy(e => e.Date).ThenBy(e => e.Id).ToListAsync(ct);
            var days = await db.Days.AsNoTracking().Where(d => d.Date >= startDate && d.Date <= endDate).OrderBy(d => d.Date).ToListAsync(ct);
            var cutoff = RetentionService.Cutoff(today, retention.DetailDays);

            http.Response.Headers.ETag = etag;
            return Results.Ok(new {
                from = startDate,
                to = endDate,
                revision = user.Revision,
                detailCutoff = cutoff,
                detailDays = retention.DetailDays,
                entries,
                days
            });
        });

        app.MapGet("/api/foods", async (HttpContext http, AppDb db, CancellationToken ct) =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
            var etag = $"\"foods:{user.Id:N}:{user.FoodRevision}\"";
            if (http.Request.Headers.IfNoneMatch == etag)
            {
                http.Response.Headers.ETag = etag;
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }
            var foods = await db.Foods.AsNoTracking().Where(f => !f.Deleted).OrderBy(f => f.Name).Take(1000).ToListAsync(ct);
            http.Response.Headers.ETag = etag;
            return Results.Ok(new {
                foods,
                revision = user.Revision,
                foodRevision = user.FoodRevision
            });
        });

        // Both routes serve the same payload; /api/training is the older client path.
        app.MapGet("/api/training/summary", TrainingSummary);
        app.MapGet("/api/training", TrainingSummary);

        app.MapGet("/api/state",async(AppDb db,RetentionService retention,ExpenditureTrajectoryService trajectory,WorkoutSummaryService training,DateOnly? date,int? year,CancellationToken ct) =>
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
            var acceptedTargetIntervals=BuildAcceptedTargetIntervals(orderedPlans,today);
            var profileObj = user.ProfileJson.Length == 0 ? null : Json.Read<Profile>(user.ProfileJson);
            var timeZone = profileObj?.TimeZone;
            // Nutrition displays scheduled training ahead of today, but the returned workout
            // context remains informational and does not extend the nutrition target interval.
            var trainingSummary = await training.Get(start, end.AddDays(14), timeZone, ct);
            var workoutConnected = await training.IsConnected(ct);
            var workoutWarning = workoutConnected ? await training.GetLastError(ct) : null;
            return Results.Ok(new {
                user.Id, displayName = user.DisplayName, user.Revision, user.ProfileRevision,
                diaryRevision = user.DiaryRevision, trajectoryRevision = user.TrajectoryRevision, bodyRevision = user.BodyRevision, foodRevision = user.FoodRevision,
                settings=new { checkInWeekday=user.CheckInWeekday,revision=user.CoachingSettingsRevision,changedDate=user.CoachingSettingsChangedDate,cadenceRevision=user.CadenceRevision,cadenceChangedDate=user.CadenceChangedDate,weightUnit=user.WeightUnit,energyUnit=user.EnergyUnit,heightUnit=user.HeightUnit,missingDayAction=user.MissingDayAction ?? "ask",weightGoalMetric=user.WeightGoalMetric ?? "scale" },
                profile=user.ProfileJson.Length==0?null:Json.Read<Profile>(user.ProfileJson), start,end,
                detailCutoff=RetentionService.Cutoff(RetentionService.Today(user.ProfileJson),retention.DetailDays),detailDays=retention.DetailDays,
                energyEstimates=energySnapshots.Select(snapshot=>new { date=snapshot.Date,revision=snapshot.SourceRevision,expenditure=snapshot.Expenditure,suggestedCalories=snapshot.SuggestedCalories,confidence=snapshot.Confidence,holdReason=snapshot.HoldReason,algorithmVersion=snapshot.AlgorithmVersion,trendWeightKg=snapshot.TrendWeightKg }),
                acceptedTargetIntervals,
                entries=await db.Entries.AsNoTracking().Where(e=>e.Date>=start&&e.Date<=end).OrderBy(e=>e.Date).ThenBy(e=>e.Id).ToListAsync(ct),
                foods=await db.Foods.AsNoTracking().Where(f=>!f.Deleted).OrderBy(f=>f.Name).Take(1000).ToListAsync(ct),
                weights=await db.Weights.Where(w=>w.Date>=start&&w.Date<=end).OrderBy(w=>w.Date).ToListAsync(ct),
                weightTrendSeed=await db.Weights.Where(w=>w.Date>=start.AddDays(-56)&&w.Date<start&&!w.Deleted).OrderBy(w=>w.Date).ToListAsync(ct),
                days=await db.Days.AsNoTracking().Where(d=>d.Date>=start&&d.Date<=end).ToListAsync(ct),
                plans=await db.Plans.OrderByDescending(p=>p.Revision).Take(12).ToListAsync(ct),
                checkIns=await db.CheckIns.OrderByDescending(c=>c.Revision).Take(12).ToListAsync(ct),
                phaseDecisions=await db.PhaseDecisions.OrderByDescending(d=>d.Revision).Take(12).ToListAsync(ct),
                trainingSummaries=trainingSummary,
                workoutConnected,
                workoutWarning
            });
        });
        app.MapGet("/api/progress/summary",async(HttpContext http,AppDb db,string? period,ProgressSummaryService progress,CancellationToken ct) =>
        {
            var user=await db.Users.AsNoTracking().SingleAsync(u=>u.Id==db.CurrentUser,ct);
            var normalized=ProgressSummaryService.NormalizePeriod(period);
            var day=RetentionService.Today(user.ProfileJson);
            var etag=ReadValidators.Progress(user,normalized,day);
            if(http.Request.Headers.IfNoneMatch==etag){http.Response.Headers.ETag=etag;return Results.StatusCode(304);}
            var summary=await progress.Get(normalized,ct);
            var finalRevision=await db.Users.AsNoTracking().Where(u=>u.Id==user.Id).Select(u=>u.Revision).SingleAsync(ct);
            if(summary.Revision==user.Revision&&finalRevision==user.Revision)http.Response.Headers.ETag=etag;
            return Results.Ok(summary);
        }).RequireRateLimiting("progress");
        app.MapPost("/api/sync",async(Mutation mutation,SyncService sync,AppDb db,IServiceScopeFactory scopes,ILogger<SyncService> logger,HttpContext http,CancellationToken ct)=>
        {
            var revision=await sync.Apply(mutation,ct);
            // The committed change owns durable work; capable clients dispatch a coalesced pass.
            if(mutation.Kind is "weight" or "weight_move" or "entry") await IntegrationDispatch.AfterCommit(http,
                () => mutation.Kind is "weight" or "weight_move" ? db.GoogleHealthWeightSyncWork.AsNoTracking().AnyAsync(work => GoogleHealthSyncLeases.Claimable.Contains(work.ProcessingState), ct)
                    : db.GoogleHealthNutritionSyncWork.AsNoTracking().AnyAsync(work => GoogleHealthSyncLeases.Claimable.Contains(work.ProcessingState), ct),
                () => GoogleHealthOutboundSync.FlushForActiveUserAsync(scopes,db.CurrentUser,logger,ct));
            return Results.Ok(await SyncWriteResults.Read(db,mutation,revision,ct));
        });
        app.MapGet("/api/coach/preview",async(CoachingService coach,CancellationToken ct)=>await coach.Preview(ct)).RequireRateLimiting("coaching");
        app.MapPost("/api/coach/accept",async(AcceptInput input,CoachingService coach,CancellationToken ct)=>await coach.Accept(input.Id,input.Revision,ct));
        app.MapPost("/api/coach/decline",async(AcceptInput input,CoachingService coach,CancellationToken ct)=>await coach.Decline(input.Id,input.Revision,ct));
        app.MapPost("/api/goal/complete",async(GoalDecisionInput input,CoachingService coach,CancellationToken ct)=>await coach.CompleteGoal(input.Id,input.Revision,input.Decision,ct));
    }

    private static async Task<IResult> TrainingSummary(HttpContext http, AppDb db, WorkoutSummaryService training,
        DateOnly? from, DateOnly? to, bool? cacheOnly, CancellationToken ct)
    {
        var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
        var today = RetentionService.Today(user.ProfileJson);
        var profile = user.ProfileJson.Length == 0 ? null : Json.Read<Profile>(user.ProfileJson);
        var start = from ?? today.AddDays(-89);
        var end = to ?? today.AddDays(14);
        var cached = await db.WorkoutSummaries.AsNoTracking().SingleOrDefaultAsync(ct);
        // Peer context is informational and is revalidated at a 15-minute cadence. A fresh cache
        // answers an unchanged browser read with no Workout call; an older cache falls through to
        // WorkoutSummaryService for revalidation.
        var force = http.Request.Query["force"] == "true";
        var ifNoneMatch = http.Request.Headers.IfNoneMatch.ToString();
        if (!force && ifNoneMatch.Length > 0 && cached?.LastSuccessAt >= DateTime.UtcNow.AddMinutes(-15)
            && ifNoneMatch == await TrainingEtag(db, user.Id, cached.Revision, start, end, ct))
        {
            http.Response.Headers.ETag = ifNoneMatch;
            return Results.StatusCode(StatusCodes.Status304NotModified);
        }
        var trainingSummary = await training.Get(start, end, profile?.TimeZone, ct, WorkoutSummaryService.RefreshDeadline, cacheOnly: cacheOnly == true);
        var workoutConnected = await training.IsConnected(ct);
        var workoutWarning = workoutConnected ? await training.GetLastError(ct) : null;
        // A refresh writes the cache and advances its revision, so the validator must describe the
        // state after that write. A pre-refresh revision would never match again and every poll
        // would call Workout.
        var refreshedCache = await db.WorkoutSummaries.AsNoTracking().Select(x => new { x.Revision, x.LastSuccessAt }).SingleOrDefaultAsync(ct);
        http.Response.Headers.ETag = await TrainingEtag(db, user.Id, refreshedCache?.Revision, start, end, ct);
        return Results.Ok(new {
            summaries = trainingSummary,
            lastSuccessAt = refreshedCache?.LastSuccessAt,
            workoutConnected,
            workoutWarning
        });
    }

    private static async Task<string> TrainingEtag(AppDb db, Guid userId, long? cacheRevision, DateOnly start, DateOnly end, CancellationToken ct)
    {
        var grantRevision = await db.IntegrationGrants.AsNoTracking()
            .Where(x => x.Peer == "workout" && x.Status == "active")
            .Select(x => (long?)x.Revision).SingleOrDefaultAsync(ct) ?? 0;
        return $"\"training:{userId:N}:{cacheRevision ?? 0}:{grantRevision}:{start:yyyy-MM-dd}:{end:yyyy-MM-dd}\"";
    }
}
