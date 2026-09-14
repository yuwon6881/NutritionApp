using Nutrition.Api.Data;

namespace Nutrition.Api.Domain;

public record GoalProgress(string Mode, double? Percent, bool Complete, DateOnly? EstimatedFinish,
    DateOnly? PhaseEnd, double? TrendWeight, double? WeeklyChange, string Explanation)
{
    public string Goal { get; init; } = "maintain";
    public double? StartWeight { get; init; }
    public double? TargetWeight { get; init; }
    public double? Remaining { get; init; }
    public double? ScaleWeight { get; init; }
    public bool DurationReached { get; init; }
    public bool ScaleReached { get; init; }
    public bool TrendReached { get; init; }
    public string? ReachedBy { get; init; }
    public DateOnly? ReachedOn { get; init; }
    public bool AwaitingTrend { get; init; }
    public DateOnly? OptimisticFinish { get; init; }
}

public static class GoalPolicy
{
    public static GoalProgress Evaluate(Profile p, IReadOnlyList<WeightPoint> weights, DateOnly today,
        PhaseDecision? decision = null, string weightGoalMetric = "scale")
    {
        var points = weights.Where(w => w.Date <= today).OrderBy(w => w.Date).ToArray();
        var trend = Coach.Trend(points);
        var current = trend.LastOrDefault()?.Kg;
        var scale = points.LastOrDefault()?.Kg;
        var startWeight = p.PhaseStartWeightKg ?? p.WeightKg;
        var goalWeight = p.PhaseMode == "weight" ? p.TargetWeightKg : null;
        var complete = decision?.Decision == "completed";
        var awaitingTrend = decision?.Decision == "await-trend";

        var currentMetricWeight = weightGoalMetric == "trend"
            ? (current ?? scale ?? startWeight)
            : (scale ?? startWeight);

        double? Remaining(bool reached) => goalWeight is not {} target
            ? null
            : reached ? 0 : Math.Max(p.Goal == "lose" ? currentMetricWeight - target : target - currentMetricWeight, 0);

        GoalProgress Progress(string mode, double? percent, bool reached, DateOnly? finish, DateOnly? end,
            double? weekly, string explanation, bool durationReached = false, bool scaleReached = false,
            bool trendReached = false, string? reachedBy = null, DateOnly? reachedOn = null,
            double? scaleWeight = null, DateOnly? optimisticFinish = null)
            => new(mode, percent, complete, finish, end, current, weekly, explanation)
            {
                Goal = p.Goal,
                StartWeight = startWeight,
                TargetWeight = goalWeight,
                Remaining = Remaining(reached || complete),
                ScaleWeight = scaleWeight,
                DurationReached = durationReached,
                ScaleReached = scaleReached,
                TrendReached = trendReached,
                ReachedBy = trendReached ? "trend" : reachedBy,
                ReachedOn = trendReached ? points.LastOrDefault()?.Date : reachedOn,
                AwaitingTrend = awaitingTrend,
                OptimisticFinish = optimisticFinish
            };

        if (p.PhaseMode == "duration" && p.PhaseStart is {} start && p.DurationWeeks is {} weeks)
        {
            var end = start.AddDays(weeks * 7);
            var durationReachedNow = today >= end;
            var durationShownAsReached = durationReachedNow || complete;
            var percent = Math.Clamp(100d * (today.DayNumber - start.DayNumber) / (weeks * 7), 0, 100);
            return Progress("duration", durationShownAsReached ? 100 : percent, durationShownAsReached, null, end, null,
                durationShownAsReached ? "Your phase duration has elapsed. Complete the goal when you are ready to review the next phase."
                    : "This percentage measures time through your phase, not fat or muscle change. Pace remains your chosen deficit or surplus.",
                durationReached: durationReachedNow, reachedBy: durationReachedNow ? "duration" : null,
                reachedOn: durationReachedNow ? end : null);
        }

        if (p.PhaseMode != "weight" || p.TargetWeightKg is not {} target)
            return Progress("open", null, complete, null, null, null,
                "Choose a duration or weight goal to track phase progress.");

        var initial = startWeight;
        var totalDelta = target - initial;
        var progressDelta = currentMetricWeight - initial;
        var percentDone = Math.Abs(totalDelta) > .001
            ? Math.Clamp(100 * progressDelta / totalDelta, 0, 100)
            : 100;

        var fresh = points.Length >= 3 && points[^1].Date >= today.AddDays(-3);
        var trendReached = fresh && points[^1].Date.DayNumber - points[^3].Date.DayNumber >= 2 &&
            trend.TakeLast(3).All(w => p.Goal == "lose" ? w.Kg <= target : w.Kg >= target);
        var scaleReached = fresh && (p.Goal == "lose" ? scale <= target : scale >= target);
        var goalReached = weightGoalMetric == "trend" ? trendReached : (scaleReached || trendReached);
        var reachedBy = trendReached ? "trend" : scaleReached ? "scale" : decision?.ReachedBy;
        var reachedOn = trendReached ? points[^1].Date : scaleReached ? points[^1].Date : decision?.Date;

        var remDistance = Remaining(goalReached || complete) ?? 0;

        DateOnly? CalculateOptimisticFinish()
        {
            if (goalReached || complete || remDistance <= 0.001) return today;
            if (p.Goal is not ("lose" or "gain")) return null;
            var goalRatePercent = Math.Abs(p.GoalRatePercent ?? (p.Goal == "lose" ? 0.5 : 0.15));
            if (goalRatePercent <= 0.0001) return null;
            var plannedWeeklyKg = (goalRatePercent / 100.0) * currentMetricWeight;
            var plannedDailyKg = plannedWeeklyKg / 7.0;

            var recentWeighIns = points.Where(w => w.Date >= today.AddDays(-28)).ToArray();
            double observedDailyKg = 0;
            if (recentWeighIns.Length >= 2 && recentWeighIns[^1].Date.DayNumber - recentWeighIns[0].Date.DayNumber >= 3)
            {
                var s = Coach.Slope(recentWeighIns);
                if ((p.Goal == "lose" && s < 0) || (p.Goal == "gain" && s > 0))
                    observedDailyKg = Math.Abs(s);
            }
            var optimisticDailyKg = Math.Max(plannedDailyKg, observedDailyKg);
            if (optimisticDailyKg <= 0.0001) return null;
            var daysRemaining = (int)Math.Ceiling(remDistance / optimisticDailyKg);
            return daysRemaining <= 730 ? today.AddDays(daysRemaining) : null;
        }

        var optFinish = CalculateOptimisticFinish();

        if (goalReached || complete)
        {
            var explanation = complete
                ? "This goal is complete. Choose when you are ready to review the next phase."
                : trendReached
                    ? "Your recent smoothed weights reached the target. Complete the goal when you are ready to review the next phase."
                    : awaitingTrend
                        ? "Your scale has reached the target. Waiting for trend weight keeps a short water shift from ending the phase."
                        : "Your latest scale weight reached the target. Complete the goal now or wait for the trend weight to confirm it.";
            return Progress("weight", 100, goalReached || complete, null, null, null, explanation,
                scaleReached: scaleReached, trendReached: trendReached, reachedBy: reachedBy,
                reachedOn: reachedOn, scaleWeight: scale, optimisticFinish: today);
        }

        var recent = points.Where(w => w.Date >= today.AddDays(-28)).ToArray();
        var enough = recent.Length >= 6 && recent[^1].Date.DayNumber - recent[0].Date.DayNumber >= 14 && fresh;
        if (!enough)
            return Progress("weight", percentDone, false, null, null, null,
                "A finish estimate needs six weigh-ins spanning at least 14 days, including one within three days.",
                scaleWeight: scale, optimisticFinish: optFinish);

        var slope = Coach.Slope(recent);
        var dailyRemaining = current is {} cur ? (target - cur) / slope : double.NaN;
        if (!double.IsFinite(dailyRemaining) || dailyRemaining <= 0 || Math.Abs(slope) < .001)
            return Progress("weight", percentDone, false, null, null, slope * 7,
                "Your observed trend is flat or moving away from this goal. No finish date can currently be estimated.",
                scaleWeight: scale, optimisticFinish: optFinish);
        if (dailyRemaining > 730)
            return Progress("weight", percentDone, false, null, null, slope * 7,
                "At your recent pace the goal is more than two years away; a precise finish date would be misleading.",
                scaleWeight: scale, optimisticFinish: optFinish);
        return Progress("weight", percentDone, false, today.AddDays((int)Math.Ceiling(dailyRemaining)), null, slope * 7,
            "Conditional estimate from the robust rate of recent recorded weights. It changes with your data and assumes the recent pace continues; it is not a promise or a fixed calorie-per-kilogram prediction.",
            scaleWeight: scale, optimisticFinish: optFinish);
    }

    // Kept for callers compiled against the pre-decision domain API. The boolean represents an
    // explicit accepted decision in those callers; live data never supplies it implicitly.
    public static GoalProgress Evaluate(Profile p, IReadOnlyList<WeightPoint> weights, DateOnly today,
        bool alreadyComplete)
        => Evaluate(p, weights, today, alreadyComplete ? new PhaseDecision { Decision = "completed" } : null);

    public static double? CarryExpenditure(Profile before, Profile after, double? learned)
    {
        if (before.Maintenance != after.Maintenance) return null;
        if (learned is not {} value) return null;
        return Math.Clamp(value * after.Activity / before.Activity, 1000, 7000);
    }
}
