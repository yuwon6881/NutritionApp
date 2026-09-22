using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record TrainingContextResponse(
    string Subject,
    long Revision,
    string TimeZone,
    string EffectiveGoal,
    bool PhaseComplete,
    double? TargetRatePercent,
    double? ObservedLossRatePercent,
    int? ObservedWindowDays,
    double? ScaleWeightKg,
    DateOnly? ScaleWeightDate,
    double? TrendWeightKg,
    DateOnly? TrendWeightDate,
    bool Confirmed);

public sealed class TrainingContextService(AppDb db)
{
    public async Task<TrainingContextResponse> Get(string subject, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.IdentitySubject == subject, ct);
        Validation.Require(user != null, "That shared account is not mapped to this Nutrition account.", 403);
        Validation.Require(!string.IsNullOrWhiteSpace(user!.ProfileJson), "Nutrition has no confirmed training context for this account.", 409);
        var profile = Json.Read<Profile>(user.ProfileJson);
        var today = RetentionService.Today(user.ProfileJson);
        var weights = await db.Weights.AsNoTracking().Where(w => !w.Deleted && w.Date <= today)
            .OrderBy(w => w.Date).Select(w => new WeightPoint(w.Date, w.Kg)).ToListAsync(ct);
        var phase = await db.PhaseDecisions.AsNoTracking()
            .SingleOrDefaultAsync(d => d.ProfileRevision == user.ProfileRevision && !d.Deleted, ct);
        var progress = GoalPolicy.Evaluate(profile, weights, today, phase, user.WeightGoalMetric ?? "scale");
        var effective = progress.Complete ? "maintain" : profile.Goal;
        var rawLast = weights.LastOrDefault();
        var trend = Coach.Trend(weights);
        var trendLast = trend.LastOrDefault();
        var observed = ObservedLoss(weights, today);
        double? target = effective == "lose" ? Math.Abs(profile.GoalRatePercent ?? Coach.EffectiveGoalRate(profile, effective)) : null;
        return new(subject, user.Revision, profile.TimeZone, effective, progress.Complete, target,
            observed?.RatePercent, observed?.WindowDays, rawLast?.Kg, rawLast?.Date, trendLast?.Kg, trendLast?.Date, true);
    }

    /// A rate is published only when the established 21-day series has at least three weigh-ins
    /// spanning fourteen days. Missing or insufficient observations remain null.
    public static (double RatePercent, int WindowDays)? ObservedLoss(IReadOnlyList<WeightPoint> weights, DateOnly today)
    {
        // Smooth the complete history first. Re-starting the trend calculation at the 21-day
        // boundary makes the first point jump with the window and can manufacture a loss/gain.
        var established = Coach.Trend(weights);
        var window = established.Where(w => w.Date >= today.AddDays(-21) && w.Date <= today).OrderBy(w => w.Date).ToList();
        if (window.Count < 3) return null;
        var span = window[^1].Date.DayNumber - window[0].Date.DayNumber;
        if (span < 14) return null;
        var first = window[0].Kg;
        var last = window[^1].Kg;
        var average = window.Average(p => p.Kg);
        if (average <= 0) return null;
        var weekly = -(last - first) / span * 7;
        return (weekly / average * 100, span);
    }
}
