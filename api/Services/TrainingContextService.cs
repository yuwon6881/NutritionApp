using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
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

public sealed class TrainingContextService(AppDb db, IMemoryCache? cache = null)
{
    private static readonly object CacheGate = new();
    private sealed class CachedContext
    {
        public SemaphoreSlim Gate { get; } = new(1, 1);
        public TrainingContextResponse? Value { get; set; }
        public DateOnly Day { get; set; }
    }

    public async Task<TrainingContextResponse> Get(string subject, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.IdentitySubject == subject, ct);
        Validation.Require(user != null, "That shared account is not mapped to this Nutrition account.", 403);
        Validation.Require(!string.IsNullOrWhiteSpace(user!.ProfileJson), "Nutrition has no confirmed training context for this account.", 409);
        var day = RetentionService.Today(user.ProfileJson);
        if (cache is null) return await Build(subject, user, ct);
        CachedContext stored;
        lock (CacheGate)
            stored = cache.GetOrCreate($"training-context:v1:{user.Id}", entry => {
                entry.Size = 1;
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);
                return new CachedContext();
            })!;
        await stored.Gate.WaitAsync(ct);
        try
        {
            if (stored.Value?.Revision == user.Revision && stored.Day == day) return stored.Value;
            var result = await Build(subject, user, ct);
            stored.Value = result;
            stored.Day = day;
            return result;
        }
        finally { stored.Gate.Release(); }
    }

    private async Task<TrainingContextResponse> Build(string subject, AppUser user, CancellationToken ct)
    {
        var profile = Json.Read<Profile>(user.ProfileJson);
        var today = RetentionService.Today(user.ProfileJson);
        var phase = await db.PhaseDecisions.AsNoTracking()
            .SingleOrDefaultAsync(d => d.ProfileRevision == user.ProfileRevision && !d.Deleted, ct);
        var weight = await WeightHistory.Compute(db, today.AddDays(-WeightSignalWindowDays), today,
            weights => WeightContext(profile, weights, today, phase, user.WeightGoalMetric ?? "scale"), ct);
        var effective = weight.Progress.Complete ? "maintain" : profile.Goal;
        double? target = effective == "lose" ? Math.Abs(profile.GoalRatePercent ?? Coach.EffectiveGoalRate(profile, effective)) : null;
        return new(subject, user.Revision, profile.TimeZone, effective, weight.Progress.Complete, target,
            weight.Observed?.RatePercent, weight.Observed?.WindowDays, weight.RawLast?.Kg, weight.RawLast?.Date,
            weight.TrendLast?.Kg, weight.TrendLast?.Date, true);
    }

    private const int WeightSignalWindowDays = 28;

    internal sealed record WeightContextResult(GoalProgress Progress, WeightPoint? RawLast, WeightPoint? TrendLast,
        (double RatePercent, int WindowDays)? Observed);

    /// The weight half of the training context, plus the earliest date it read (see WeightHistory).
    internal static (WeightContextResult Result, DateOnly? Earliest) WeightContext(Profile profile, IReadOnlyList<WeightPoint> weights,
        DateOnly today, PhaseDecision? phase, string metric)
    {
        var trend = WeightSignal.CleanTrend(weights, today, WeightSignalWindowDays);
        var counted = WeightContextPolicy.ForCalorieEstimation(weights);
        var progress = GoalPolicy.Evaluate(profile, counted, today, phase, metric, trend);
        // Workout freezes this as a bodyweight-load reference: a weigh-in the user marked as a
        // temporary fluctuation (bloating, a salty meal) is not their weight until later ones confirm it.
        var result = new WeightContextResult(progress, counted.LastOrDefault(), trend.LastOrDefault(), ObservedLossFromTrend(trend, today));
        // The goal check reads the last three counted weigh-ins and the last three trend points.
        DateOnly? earliest = counted.Count < 3 || trend.Count < 3 ? null
            : new[] { today.AddDays(-WeightSignalWindowDays), counted[^3].Date, trend[^3].Date }.Min();
        return (result, earliest);
    }

    /// A rate is published only when the established 21-day series has at least three weigh-ins
    /// spanning fourteen days. Missing or insufficient observations remain null.
    public static (double RatePercent, int WindowDays)? ObservedLoss(IReadOnlyList<WeightPoint> weights, DateOnly today)
    {
        // Smooth the complete history first. Re-starting the trend calculation at the 21-day
        // boundary makes the first point jump with the window and can manufacture a loss/gain.
        var established = WeightSignal.CleanTrend(weights, today);
        return ObservedLossFromTrend(established, today);
    }

    private static (double RatePercent, int WindowDays)? ObservedLossFromTrend(IReadOnlyList<WeightPoint> established, DateOnly today)
    {
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
