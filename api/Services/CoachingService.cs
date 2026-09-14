using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public record PlanDiff(double? PreviousCalories, double? ProposedCalories, double? PreviousExpenditure,
    double? ProposedExpenditure, double? PreviousProtein, double? ProposedProtein,
    double? PreviousCarbs, double? ProposedCarbs, double? PreviousFat, double? ProposedFat,
    string PreviousEffectiveGoal, string ProposedEffectiveGoal);

public record CoachingPreview(long Revision, CoachResult Result, bool CanAccept, string? HoldReason,
    DateOnly WeekStart, DateOnly NextCheckIn, PlanDiff? Changes, EnergyEvidence? Evidence);

public sealed class CoachingService(AppDb db, ExpenditureTrajectoryService? trajectory = null)
{
    public async Task<CoachingPreview> Preview(CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var result = await PreviewCore(ct);
        await gate.Commit(ct);
        return result;
    }

    private async Task<CoachingPreview> PreviewCore(CancellationToken ct)
    {
        var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
        Validation.Require(user.ProfileJson.Length > 0, "Complete your coaching profile first.");
        var profile = Json.Read<Profile>(user.ProfileJson);
        var today = Today(profile);
        var since = today.AddDays(-28);
        var statuses = await db.Days.Where(d => d.Date >= since && d.Date < today && !d.Deleted).ToListAsync(ct);
        var totals = await db.Entries.Where(e => e.Date >= since && e.Date < today && !e.Deleted)
            .GroupBy(e => e.Date).Select(g => new { Date = g.Key, Calories = g.Sum(e => e.Calories) })
            .ToDictionaryAsync(x => x.Date, x => x.Calories, ct);
        var dates = statuses.Select(d => d.Date).Union(totals.Keys);
        var days = dates.Select(date =>
        {
            var d = statuses.Find(item => item.Date == date);
            return new NutritionDay(date,
                LoggingDay.Status(date, today, d?.Status,
                    d?.Archived == true ? d.EntryCount > 0 : totals.ContainsKey(date)),
                d?.Archived == true ? d.Calories : totals.GetValueOrDefault(date));
        }).ToList();
        var weights = await db.Weights.Where(w => w.Date >= since.AddDays(-56) && w.Date <= today && !w.Deleted)
            .OrderBy(w => w.Date).Select(w => new WeightPoint(w.Date, w.Kg)).ToListAsync(ct);
        var last = await db.Plans.OrderByDescending(p => p.Revision).FirstOrDefaultAsync(ct);
        var accepted = last == null ? null : Json.Read<CoachResult>(last.ResultJson);
        var previous = last?.ProfileRevision == user.ProfileRevision ? accepted : null;
        var seed = last != null && previous == null
            ? GoalPolicy.CarryExpenditure(Json.Read<Profile>(last.ProfileJson), profile, accepted?.Expenditure)
            : null;
        var phaseDecision = await db.PhaseDecisions
            .SingleOrDefaultAsync(d => d.ProfileRevision == user.ProfileRevision && !d.Deleted, ct);
        var weekday = user.CheckInWeekday is >= 0 and <= 6 ? user.CheckInWeekday : CheckInWeek.Monday;
        var weekStart = CheckInWeek.PeriodStart(today, weekday);
        var declined = await db.CheckIns.AnyAsync(d => d.WeekStart == weekStart && d.CheckInWeekday == weekday && d.Decision == "declined" && !d.Deleted, ct);
        var newWeek = last != null && weekStart > CheckInWeek.PeriodStart(last.Date, weekday);
        var adaptationDue = last == null || last.ProfileRevision != user.ProfileRevision || newWeek;
        var result = Coach.Calculate(profile, days, weights,
            previous?.Calories is {} calories && previous.Expenditure is {} expenditure
                ? new PreviousPlan(calories, expenditure)
                : null,
            today, seed, adaptationDue, phaseDecision, user.WeightGoalMetric ?? "scale");
        var trajectoryPoint = trajectory == null ? null : await trajectory.LatestUnderLock(ct);
        if (trajectoryPoint?.Expenditure is {} learned)
        {
            // The learned expenditure replaces the accepted seed, but the calorie target and
            // everything derived from it — macros, the weekly budget, and the seven dated targets —
            // must come from one calculation. The advisory snapshot contributes only its adaptation
            // state and hold reason: its own suggestion reads profile.Goal directly and would both
            // desynchronise the macros and reinstate a deficit on a completed phase.
            var provisional = Coach.Calculate(profile, days, weights, null, today, learned, false, phaseDecision, user.WeightGoalMetric ?? "scale");
            result = provisional with
            {
                Adaptive = trajectoryPoint.SuggestedCalories != null,
                Explanation = trajectoryPoint.HoldReason ?? provisional.Explanation
            };
        }
        // A completed phase gets one immediate maintenance proposal. The decision is explicit,
        // so this is separate from the normal Monday cadence and cannot be triggered by scale data.
        var completionDue = result.PhaseComplete && phaseDecision?.Decision == "completed" && accepted?.PhaseComplete != true;
        var cadenceChanged = last != null && last.ProfileRevision == user.ProfileRevision &&
            (last.CheckInWeekday != weekday || last.CoachingSettingsRevision != user.CoachingSettingsRevision);
        var cadenceNext = user.CoachingSettingsChangedDate is {} changedDate
            ? CheckInWeek.NextOccurrenceAfter(changedDate, weekday)
            : CheckInWeek.NextOccurrenceAfter(last?.Date ?? today, weekday);
        var cadenceDue = cadenceChanged && today >= cadenceNext;
        var due = last == null || last.ProfileRevision != user.ProfileRevision ||
            (!cadenceChanged && newWeek && !declined) || (cadenceDue && !declined) || completionDue;
        var nextCheckIn = last == null
            ? weekStart
            : cadenceChanged ? cadenceNext : CheckInWeek.NextCheckIn(last.Date, weekday);
        var changes = accepted == null ? null : new PlanDiff(
            accepted.Calories, result.Calories, accepted.Expenditure, result.Expenditure,
            accepted.Protein, result.Protein, accepted.Carbs, result.Carbs,
            accepted.Fat, result.Fat, accepted.EffectiveGoal, result.EffectiveGoal);
        var hold = due ? null : declined
            ? $"You kept your current targets this week. The next check-in is available on {nextCheckIn:yyyy-MM-dd}."
            : cadenceChanged
                ? $"Your check-in day changed. The next check-in is available on {nextCheckIn:yyyy-MM-dd}."
            : $"Your next check-in is available on {nextCheckIn:yyyy-MM-dd}.";
        // A trajectory hold keeps the advisory estimate unknown, but it does not
        // block the user from explicitly accepting an otherwise valid equation-
        // based proposal. Continuous guidance and active targets have separate
        // lifecycles.
        var canAccept = result.Eligible && due;
        return new(user.Revision, result, canAccept, hold, weekStart, nextCheckIn, changes, result.Evidence);
    }

    public async Task<AcceptedPlan> Accept(Guid id, long inputRevision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var duplicate = await db.Plans.SingleOrDefaultAsync(p => p.Id == id, ct);
        if (duplicate != null)
        {
            Validation.Require(duplicate.InputRevision == inputRevision, "Acceptance identity was reused.", 409);
            return duplicate;
        }
        var preview = await PreviewCore(ct);
        Validation.Require(preview.Revision == inputRevision, "Your data changed. Refresh this proposal before accepting.", 409);
        Validation.Require(preview.CanAccept, preview.HoldReason ?? preview.Result.Explanation, 409);
        var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
        var profile = Json.Read<Profile>(user.ProfileJson);
        var today = Today(profile);
        var plan = new AcceptedPlan
        {
            Id = id,
            UserId = user.Id,
            Revision = ++user.Revision,
            Date = today,
            InputRevision = inputRevision,
            ProfileRevision = user.ProfileRevision,
            CoachingSettingsRevision = user.CoachingSettingsRevision,
            CheckInWeekday = user.CheckInWeekday,
            ResultJson = Json.Write(preview.Result),
            ProfileJson = user.ProfileJson
        };
        db.Plans.Add(plan);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return plan;
    }

    public async Task<CheckInDecision> Decline(Guid id, long inputRevision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var duplicate = await db.CheckIns.SingleOrDefaultAsync(d => d.Id == id, ct);
        if (duplicate != null)
        {
            Validation.Require(duplicate.InputRevision == inputRevision, "Decline identity was reused.", 409);
            return duplicate;
        }
        var preview = await PreviewCore(ct);
        Validation.Require(preview.Revision == inputRevision, "Your data changed. Refresh this proposal before declining.", 409);
        Validation.Require(preview.CanAccept, preview.HoldReason ?? preview.Result.Explanation, 409);
        var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
        var profile = Json.Read<Profile>(user.ProfileJson);
        var decision = new CheckInDecision
        {
            Id = id,
            UserId = user.Id,
            Revision = ++user.Revision,
            WeekStart = preview.WeekStart,
            CheckInWeekday = user.CheckInWeekday,
            Date = Today(profile),
            Decision = "declined",
            InputRevision = inputRevision,
            ResultJson = Json.Write(preview.Result)
        };
        db.CheckIns.Add(decision);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return decision;
    }

    public async Task<PhaseDecision> CompleteGoal(Guid id, long inputRevision, string decision, CancellationToken ct)
    {
        Validation.Require(decision is "completed" or "await-trend", "Choose a supported goal decision.");
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var hash = AuthService.Hash(Json.Write(new { id, inputRevision, decision }));
        var receipt = await db.Receipts.SingleOrDefaultAsync(r => r.Id == id, ct);
        if (receipt != null)
        {
            Validation.Require(receipt.Hash == hash, "Goal decision identity was reused.", 409);
            var replay = await db.PhaseDecisions.IgnoreQueryFilters()
                .SingleOrDefaultAsync(d => d.UserId == db.CurrentUser && d.Revision == receipt.Revision, ct);
            Validation.Require(replay != null, "The previous goal decision is no longer available.", 409);
            return replay!;
        }
        var user = await db.Users.SingleAsync(u => u.Id == db.CurrentUser, ct);
        Validation.Require(user.Revision == inputRevision, "Your data changed. Refresh the goal before deciding.", 409);
        Validation.Require(user.ProfileJson.Length > 0, "Complete your coaching profile first.");
        var profile = Json.Read<Profile>(user.ProfileJson);
        var today = Today(profile);
        var weights = await db.Weights.Where(w => !w.Deleted).OrderBy(w => w.Date)
            .Select(w => new WeightPoint(w.Date, w.Kg)).ToListAsync(ct);
        var current = await db.PhaseDecisions
            .SingleOrDefaultAsync(d => d.ProfileRevision == user.ProfileRevision && !d.Deleted, ct);
        var progress = GoalPolicy.Evaluate(profile, weights, today, current, user.WeightGoalMetric ?? "scale");
        var reached = decision == "await-trend"
            ? progress.ScaleReached
            : progress.DurationReached || progress.ScaleReached || progress.TrendReached || progress.Complete;
        Validation.Require(reached, "The matching goal milestone has not been reached yet.", 409);
        var reachedBy = decision == "await-trend"
            ? "scale"
            : progress.TrendReached ? "trend" : progress.DurationReached ? "duration" : "scale";
        var next = current ?? new PhaseDecision { Id = id, UserId = user.Id };
        next.Date = today;
        next.ProfileRevision = user.ProfileRevision;
        next.ReachedBy = reachedBy;
        next.Decision = decision;
        next.Revision = ++user.Revision;
        next.Deleted = false;
        if (current == null) db.PhaseDecisions.Add(next);
        db.Receipts.Add(new MutationReceipt { Id = id, UserId = user.Id, Hash = hash, Revision = user.Revision });
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
        return next;
    }

    private static DateOnly Today(Profile profile)
        => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById(profile.TimeZone)));
}
