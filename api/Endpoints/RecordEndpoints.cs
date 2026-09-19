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

        app.MapGet("/api/bootstrap", async (HttpContext http, AppDb db, RetentionService retention, ExpenditureTrajectoryService trajectory, WorkoutSummaryService training, CancellationToken ct) =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
            var etag = $"\"{user.Revision}\"";
            if (http.Request.Headers.IfNoneMatch == etag)
            {
                http.Response.Headers.ETag = etag;
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }
            var snapshots = await trajectory.EnsureThroughToday(ct);
            var today = RetentionService.Today(user.ProfileJson);
            var end = today;
            var start = end.AddDays(-89);
            var energySnapshots = snapshots.Where(snapshot => snapshot.Date >= start && snapshot.Date <= end).ToList();
            var precedingSnapshot = snapshots.Where(snapshot => snapshot.Date < start).OrderByDescending(snapshot => snapshot.Date).FirstOrDefault();
            if (precedingSnapshot != null) energySnapshots.Insert(0, precedingSnapshot);
            var orderedPlans = await db.Plans.OrderBy(plan => plan.Date).ThenBy(plan => plan.Revision).ToListAsync(ct);
            var acceptedTargetIntervals = BuildAcceptedTargetIntervals(orderedPlans, today);
            var workoutConnected = await training.IsConnected(ct);
            var workoutWarning = workoutConnected ? await training.GetLastError(ct) : null;
            http.Response.Headers.ETag = etag;
            return Results.Ok(new {
                user.Id, displayName = user.DisplayName, user.Revision, user.ProfileRevision,
                diaryRevision = user.DiaryRevision, trajectoryRevision = user.TrajectoryRevision, bodyRevision = user.BodyRevision, foodRevision = user.FoodRevision,
                settings = new { checkInWeekday = user.CheckInWeekday, revision = user.CoachingSettingsRevision, changedDate = user.CoachingSettingsChangedDate, weightUnit = user.WeightUnit, energyUnit = user.EnergyUnit, heightUnit = user.HeightUnit, missingDayAction = user.MissingDayAction ?? "ask", weightGoalMetric = user.WeightGoalMetric ?? "scale" },
                profile = user.ProfileJson.Length == 0 ? null : Json.Read<Profile>(user.ProfileJson),
                start, end,
                detailCutoff = RetentionService.Cutoff(today, retention.DetailDays),
                detailDays = retention.DetailDays,
                energyEstimates = energySnapshots.Select(snapshot => new { date = snapshot.Date, revision = snapshot.SourceRevision, expenditure = snapshot.Expenditure, suggestedCalories = snapshot.SuggestedCalories, confidence = snapshot.Confidence, holdReason = snapshot.HoldReason, algorithmVersion = snapshot.AlgorithmVersion, trendWeightKg = snapshot.TrendWeightKg }),
                acceptedTargetIntervals,
                entries = await db.Entries.Where(e => e.Date >= start && e.Date <= end).OrderBy(e => e.Date).ThenBy(e => e.Id).ToListAsync(ct),
                weights = await db.Weights.Where(w => w.Date >= start && w.Date <= end).OrderBy(w => w.Date).ToListAsync(ct),
                weightTrendSeed = await db.Weights.Where(w => w.Date >= start.AddDays(-56) && w.Date < start && !w.Deleted).OrderBy(w => w.Date).ToListAsync(ct),
                days = await db.Days.Where(d => d.Date >= start && d.Date <= end).ToListAsync(ct),
                plans = await db.Plans.OrderByDescending(p => p.Revision).Take(12).ToListAsync(ct),
                checkIns = await db.CheckIns.OrderByDescending(c => c.Revision).Take(12).ToListAsync(ct),
                phaseDecisions = await db.PhaseDecisions.OrderByDescending(d => d.Revision).Take(12).ToListAsync(ct),
                workoutConnected,
                workoutWarning
            });
        });

        app.MapGet("/api/diary", async (HttpContext http, AppDb db, RetentionService retention, DateOnly? from, DateOnly? to, CancellationToken ct) =>
        {
            Validation.Require(from is not null && to is not null, "Specify both 'from' and 'to' dates.");
            var startDate = from!.Value;
            var endDate = to!.Value;
            Validation.Require(startDate <= endDate, "The start date must be before or equal to the end date.");
            Validation.Require(endDate.DayNumber - startDate.DayNumber + 1 <= 31, "Diary range cannot exceed 31 days.");
            var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
            var today = RetentionService.Today(user.ProfileJson);
            Validation.Require(startDate >= new DateOnly(2000, 1, 1) && endDate <= today, "Choose a supported diary date.");

            // Diary reads depend on diary mutations and the local-day retention boundary. Profile,
            // food, or training changes do not invalidate an unchanged historical range.
            var etag = $"\"diary:{user.Id:N}:{user.DiaryRevision}:{startDate:yyyy-MM-dd}:{endDate:yyyy-MM-dd}:{today:yyyy-MM-dd}:{retention.DetailDays}\"";
            if (http.Request.Headers.IfNoneMatch == etag)
            {
                http.Response.Headers.ETag = etag;
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }

            var entries = await db.Entries.Where(e => e.Date >= startDate && e.Date <= endDate).OrderBy(e => e.Date).ThenBy(e => e.Id).ToListAsync(ct);
            var days = await db.Days.Where(d => d.Date >= startDate && d.Date <= endDate).OrderBy(d => d.Date).ToListAsync(ct);
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
            var foods = await db.Foods.Where(f => !f.Deleted).OrderBy(f => f.Name).Take(1000).ToListAsync(ct);
            http.Response.Headers.ETag = etag;
            return Results.Ok(new {
                foods,
                revision = user.Revision,
                foodRevision = user.FoodRevision
            });
        });

        app.MapGet("/api/training/summary", async (HttpContext http, AppDb db, WorkoutSummaryService training, DateOnly? from, DateOnly? to, CancellationToken ct) =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
            var today = RetentionService.Today(user.ProfileJson);
            var start = from ?? today.AddDays(-89);
            var end = to ?? today.AddDays(14);
            var cached = await db.WorkoutSummaries.AsNoTracking().SingleOrDefaultAsync(ct);
            var grantRevision = await db.IntegrationGrants.AsNoTracking()
                .Where(x => x.Peer == "workout" && x.Status == "active")
                .Select(x => (long?)x.Revision).SingleOrDefaultAsync(ct) ?? 0;
            var etag = $"\"training:{user.Id:N}:{cached?.Revision ?? 0}:{grantRevision}:{start:yyyy-MM-dd}:{end:yyyy-MM-dd}\"";
            // Peer context is informational and is revalidated at the existing two-minute
            // cadence. A fresh cache can answer an unchanged browser read with no provider call;
            // an older cache still falls through to WorkoutSummaryService for revalidation.
            if (http.Request.Headers.IfNoneMatch == etag && cached?.LastSuccessAt >= DateTime.UtcNow.AddMinutes(-2))
            {
                http.Response.Headers.ETag = etag;
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }
            var trainingSummary = await training.Get(start, end, ct);
            var workoutConnected = await training.IsConnected(ct);
            var workoutWarning = workoutConnected ? await training.GetLastError(ct) : null;
            http.Response.Headers.ETag = etag;
            return Results.Ok(new {
                summaries = trainingSummary,
                workoutConnected,
                workoutWarning
            });
        });

        app.MapGet("/api/training", async (HttpContext http, AppDb db, WorkoutSummaryService training, DateOnly? from, DateOnly? to, CancellationToken ct) =>
        {
            var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
            var today = RetentionService.Today(user.ProfileJson);
            var start = from ?? today.AddDays(-89);
            var end = to ?? today.AddDays(14);
            var cached = await db.WorkoutSummaries.AsNoTracking().SingleOrDefaultAsync(ct);
            var grantRevision = await db.IntegrationGrants.AsNoTracking()
                .Where(x => x.Peer == "workout" && x.Status == "active")
                .Select(x => (long?)x.Revision).SingleOrDefaultAsync(ct) ?? 0;
            var etag = $"\"training:{user.Id:N}:{cached?.Revision ?? 0}:{grantRevision}:{start:yyyy-MM-dd}:{end:yyyy-MM-dd}\"";
            if (http.Request.Headers.IfNoneMatch == etag && cached?.LastSuccessAt >= DateTime.UtcNow.AddMinutes(-2))
            {
                http.Response.Headers.ETag = etag;
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }
            var trainingSummary = await training.Get(start, end, ct);
            var workoutConnected = await training.IsConnected(ct);
            var workoutWarning = workoutConnected ? await training.GetLastError(ct) : null;
            http.Response.Headers.ETag = etag;
            return Results.Ok(new {
                summaries = trainingSummary,
                workoutConnected,
                workoutWarning
            });
        });

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
            // Nutrition displays scheduled training ahead of today, but the returned workout
            // context remains informational and does not extend the nutrition target interval.
            var trainingSummary = await training.Get(start, end.AddDays(14), ct);
            var workoutConnected = await training.IsConnected(ct);
            var workoutWarning = workoutConnected ? await training.GetLastError(ct) : null;
            return Results.Ok(new {
                user.Id, displayName = user.DisplayName, user.Revision, user.ProfileRevision,
                diaryRevision = user.DiaryRevision, trajectoryRevision = user.TrajectoryRevision, bodyRevision = user.BodyRevision, foodRevision = user.FoodRevision,
                settings=new { checkInWeekday=user.CheckInWeekday,revision=user.CoachingSettingsRevision,changedDate=user.CoachingSettingsChangedDate,weightUnit=user.WeightUnit,energyUnit=user.EnergyUnit,heightUnit=user.HeightUnit,missingDayAction=user.MissingDayAction ?? "ask",weightGoalMetric=user.WeightGoalMetric ?? "scale" },
                profile=user.ProfileJson.Length==0?null:Json.Read<Profile>(user.ProfileJson), start,end,
                detailCutoff=RetentionService.Cutoff(RetentionService.Today(user.ProfileJson),retention.DetailDays),detailDays=retention.DetailDays,
                energyEstimates=energySnapshots.Select(snapshot=>new { date=snapshot.Date,revision=snapshot.SourceRevision,expenditure=snapshot.Expenditure,suggestedCalories=snapshot.SuggestedCalories,confidence=snapshot.Confidence,holdReason=snapshot.HoldReason,algorithmVersion=snapshot.AlgorithmVersion,trendWeightKg=snapshot.TrendWeightKg }),
                acceptedTargetIntervals,
                entries=await db.Entries.Where(e=>e.Date>=start&&e.Date<=end).OrderBy(e=>e.Date).ThenBy(e=>e.Id).ToListAsync(ct),
                foods=await db.Foods.Where(f=>!f.Deleted).OrderBy(f=>f.Name).Take(1000).ToListAsync(ct),
                weights=await db.Weights.Where(w=>w.Date>=start&&w.Date<=end).OrderBy(w=>w.Date).ToListAsync(ct),
                weightTrendSeed=await db.Weights.Where(w=>w.Date>=start.AddDays(-56)&&w.Date<start&&!w.Deleted).OrderBy(w=>w.Date).ToListAsync(ct),
                days=await db.Days.Where(d=>d.Date>=start&&d.Date<=end).ToListAsync(ct),
                plans=await db.Plans.OrderByDescending(p=>p.Revision).Take(12).ToListAsync(ct),
                checkIns=await db.CheckIns.OrderByDescending(c=>c.Revision).Take(12).ToListAsync(ct),
                phaseDecisions=await db.PhaseDecisions.OrderByDescending(d=>d.Revision).Take(12).ToListAsync(ct),
                trainingSummaries=trainingSummary,
                workoutConnected,
                workoutWarning
            });
        });
        app.MapGet("/api/progress/summary",async(string? period,ProgressSummaryService progress,CancellationToken ct)
            =>Results.Ok(await progress.Get(period,ct)));
        app.MapPost("/api/sync",async(Mutation mutation,SyncService sync,CancellationToken ct)=>Results.Ok(new { revision=await sync.Apply(mutation,ct) }));
        app.MapGet("/api/coach/preview",async(CoachingService coach,CancellationToken ct)=>await coach.Preview(ct));
        app.MapPost("/api/coach/accept",async(AcceptInput input,CoachingService coach,CancellationToken ct)=>await coach.Accept(input.Id,input.Revision,ct));
        app.MapPost("/api/coach/decline",async(AcceptInput input,CoachingService coach,CancellationToken ct)=>await coach.Decline(input.Id,input.Revision,ct));
        app.MapPost("/api/goal/complete",async(GoalDecisionInput input,CoachingService coach,CancellationToken ct)=>await coach.CompleteGoal(input.Id,input.Revision,input.Decision,ct));
        app.MapGet("/api/export",async(ExportService export,CancellationToken ct)=>
            Results.Stream(async stream=>await System.Text.Json.JsonSerializer.SerializeAsync(stream,await export.BuildJsonDocument(ct),Json.Options,ct),"application/json","nutrition-export.json"))
            .RequireRateLimiting("export");
        app.MapGet("/api/export/csv",(ExportService export,CancellationToken ct)=>
            Results.Stream(stream=>export.WriteCsvBundle(stream,ct),"application/zip","nutrition-export-csv.zip"))
            .RequireRateLimiting("export");
    }
}
