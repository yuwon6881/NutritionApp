using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Endpoints;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed class BootstrapReadService(AppDb db, RetentionService retention, ExpenditureTrajectoryService trajectory)
{
    public async Task<IResult> Get(HttpContext http, CancellationToken ct)
    {
        using var timing = PerformanceMetrics.Measure("bootstrap.read");
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == db.CurrentUser, ct);
        var grant = await db.IntegrationGrants.AsNoTracking().Where(g => g.Peer == "workout")
            .Select(g => new {g.Revision, Connected = g.Status == "active" && g.CentralConnectionId != null && g.CentralGeneration != null})
            .SingleOrDefaultAsync(ct);
        var training = await db.WorkoutSummaries.AsNoTracking()
            .Select(s => new {s.Revision, s.LastErrorAt, s.LastError}).SingleOrDefaultAsync(ct);
        var today = RetentionService.Today(user.ProfileJson);
        var connected = grant?.Connected == true;
        var warning = connected && training?.LastErrorAt != null && !string.IsNullOrWhiteSpace(training?.LastError);
        var etag = ReadValidators.Bootstrap(user, today, retention.DetailDays, grant?.Revision ?? 0, training?.Revision ?? 0, connected, warning);
        if (http.Request.Headers.IfNoneMatch == etag)
        {
            http.Response.Headers.ETag = etag;
            return Results.StatusCode(StatusCodes.Status304NotModified);
        }
        var snapshots = await trajectory.EnsureThroughToday(ct);
        var start = today.AddDays(-89);
        var energySnapshots = snapshots.Where(s => s.Date >= start && s.Date <= today).ToList();
        var preceding = snapshots.Where(s => s.Date < start).OrderByDescending(s => s.Date).FirstOrDefault();
        if (preceding != null) energySnapshots.Insert(0, preceding);
        var orderedPlans = await db.Plans.AsNoTracking().OrderBy(p => p.Date).ThenBy(p => p.Revision)
            .Select(p => new AcceptedPlan {Date = p.Date, Revision = p.Revision, ResultJson = p.ResultJson}).ToListAsync(ct);
        // This span includes reader iteration/materialization. SQL execution is measured independently.
        object payload;
        using (PerformanceMetrics.Measure("bootstrap.materialization"))
        {
            payload = new {
                user.Id, displayName = user.DisplayName, user.Revision, user.ProfileRevision,
                diaryRevision = user.DiaryRevision, trajectoryRevision = user.TrajectoryRevision, bodyRevision = user.BodyRevision, foodRevision = user.FoodRevision,
                settings = new {checkInWeekday=user.CheckInWeekday,revision=user.CoachingSettingsRevision,changedDate=user.CoachingSettingsChangedDate,cadenceRevision=user.CadenceRevision,cadenceChangedDate=user.CadenceChangedDate,
                    weightUnit=user.WeightUnit,energyUnit=user.EnergyUnit,heightUnit=user.HeightUnit,missingDayAction=user.MissingDayAction ?? "ask",weightGoalMetric=user.WeightGoalMetric ?? "scale"},
                profile = user.ProfileJson.Length == 0 ? null : Json.Read<Profile>(user.ProfileJson),
                start, end = today, detailCutoff = RetentionService.Cutoff(today,retention.DetailDays), detailDays = retention.DetailDays,
                energyEstimates = energySnapshots.Select(s => new {date=s.Date,revision=s.SourceRevision,expenditure=s.Expenditure,suggestedCalories=s.SuggestedCalories,
                    confidence=s.Confidence,holdReason=s.HoldReason,algorithmVersion=s.AlgorithmVersion,trendWeightKg=s.TrendWeightKg}),
                acceptedTargetIntervals = RecordEndpoints.BuildAcceptedTargetIntervals(orderedPlans,today),
                entries = await db.Entries.AsNoTracking().Where(e => e.Date >= start && e.Date <= today).OrderBy(e => e.Date).ThenBy(e => e.Id).ToListAsync(ct),
                weights = await db.Weights.AsNoTracking().Where(w => w.Date >= start && w.Date <= today).OrderBy(w => w.Date).ToListAsync(ct),
                weightTrendSeed = await db.Weights.AsNoTracking().Where(w => w.Date >= start.AddDays(-56) && w.Date < start && !w.Deleted).OrderBy(w => w.Date).ToListAsync(ct),
                days = await db.Days.AsNoTracking().Where(d => d.Date >= start && d.Date <= today).ToListAsync(ct),
                plans = await db.Plans.AsNoTracking().OrderByDescending(p => p.Revision).Take(12).ToListAsync(ct),
                checkIns = await db.CheckIns.AsNoTracking().OrderByDescending(c => c.Revision).Take(12).ToListAsync(ct),
                phaseDecisions = await db.PhaseDecisions.AsNoTracking().OrderByDescending(d => d.Revision).Take(12).ToListAsync(ct),
                workoutConnected = connected,
                workoutWarning = warning ? "Workout training summaries are temporarily unavailable. Try again later." : null
            };
        }
        // A concurrent write may have changed collections during this read. Do not
        // attach a reusable validator to a response that crossed a revision boundary.
        var finalRevision = await db.Users.AsNoTracking().Where(u => u.Id == user.Id).Select(u => u.Revision).SingleAsync(ct);
        if (finalRevision == user.Revision) http.Response.Headers.ETag = etag;
        return Results.Ok(payload);
    }
}
