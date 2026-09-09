namespace Nutrition.Api.Domain;

public record EnergyEvidence(int WindowDays, int LoggedDays, double Coverage, int WeighIns,
    int WeighInSpanDays, double MeanIntake, double SlopeKgPerDay, double NoiseKg,
    int WaterFlaggedDays, double Confidence);

public record ExpenditureEstimate(bool Adaptive, double Expenditure, double? Observed,
    double Gain, EnergyEvidence Evidence, string Reason);

public record WeightSignalResult(IReadOnlyList<WeightPoint> Retained, double NoiseKg,
    int WaterFlaggedDays, double? TheilSenSlopeKgPerDay, double? EndpointSlopeKgPerDay);

public static class WeightSignal
{
    public static WeightSignalResult Analyze(IReadOnlyList<WeightPoint> weights, DateOnly today, int windowDays = 28)
    {
        var start = today.AddDays(-windowDays);
        var points = weights.Where(w => w.Date >= start && w.Date < today).OrderBy(w => w.Date).ToArray();
        var all = weights.Where(w => w.Date <= today).OrderBy(w => w.Date).ToArray();
        var trends = Coach.Trend(all).ToDictionary(w => w.Date, w => w.Kg);
        var residuals = points.Select(w => w.Kg - trends[w.Date]).ToArray();
        var noise = MedianAbsoluteDeviation(residuals);
        var threshold = 3 * Math.Max(noise, .3);
        var flagged = points.Where((w, i) => Math.Abs(residuals[i]) > threshold).ToArray();
        var flaggedDates = flagged.Select(w => w.Date).ToHashSet();
        var retained = points.Where(w => !flaggedDates.Contains(w.Date))
            .Select(w => new WeightPoint(w.Date, trends[w.Date])).ToArray();

        var first = retained.Where(w => w.Date >= start && w.Date < start.AddDays(7)).Select(w => w.Kg).ToArray();
        var last = retained.Where(w => w.Date >= today.AddDays(-7) && w.Date < today).Select(w => w.Kg).ToArray();
        var endpoint = first.Length > 0 && last.Length > 0
            ? (double?)(Median(last) - Median(first)) / 21d
            : (double?)null;
        var theil = retained.Length >= 2 ? (double?)Coach.Slope(retained) : null;
        return new(retained, noise, flagged.Length, theil, endpoint);
    }

    private static double MedianAbsoluteDeviation(IReadOnlyList<double> values)
    {
        if (values.Count == 0) return 0;
        var center = Median(values);
        return Median(values.Select(value => Math.Abs(value - center)).ToArray());
    }

    private static double Median(IReadOnlyList<double> values)
    {
        var sorted = values.OrderBy(value => value).ToArray();
        if (sorted.Length == 0) return 0;
        return sorted.Length % 2 == 1
            ? sorted[sorted.Length / 2]
            : (sorted[sorted.Length / 2 - 1] + sorted[sorted.Length / 2]) / 2;
    }
}

public static class Expenditure
{
    public static ExpenditureEstimate Estimate(IReadOnlyList<NutritionDay> days,
        IReadOnlyList<WeightPoint> weights, double expenditure, DateOnly today, bool allowAdaptation = true)
    {
        const int windowDays = 28;
        var start = today.AddDays(-windowDays);
        var window = days.Where(d => d.Date >= start && d.Date < today)
            .GroupBy(d => d.Date).Select(group => group.Last()).ToArray();
        var logged = window.Where(IsLogged).ToArray();
        var coverage = logged.Length / (double)windowDays;
        var signal = WeightSignal.Analyze(weights, today, windowDays);
        var retained = signal.Retained;
        var span = retained.Count < 2 ? 0 : retained[^1].Date.DayNumber - retained[0].Date.DayNumber;
        var firstHalf = retained.Count(w => w.Date < start.AddDays(windowDays / 2));
        var secondHalf = retained.Count(w => w.Date >= start.AddDays(windowDays / 2));
        var mostRecent = retained.LastOrDefault()?.Date;
        var coverageFactor = Math.Clamp(coverage / .85, 0, 1);
        var densityFactor = Math.Clamp(retained.Count / 14d, 0, 1);
        var precisionFactor = Math.Clamp(1 - signal.NoiseKg / .8, .5, 1);
        var confidence = coverageFactor * densityFactor * precisionFactor;
        var gain = Math.Clamp(.25 * confidence, .08, .30);
        var evidence = new EnergyEvidence(windowDays, logged.Length, coverage, retained.Count, span,
            logged.Length == 0 ? 0 : logged.Average(d => d.Calories), signal.TheilSenSlopeKgPerDay ?? 0,
            signal.NoiseKg, signal.WaterFlaggedDays, confidence);

        var prefix = $"{logged.Length} of {windowDays} days logged; unlogged days are excluded and may bias this estimate. " +
            "The 28-day window spans a full menstrual cycle.";
        if (signal.WaterFlaggedDays > 0)
            prefix += $" Flagged {signal.WaterFlaggedDays} possible water or level-shift weigh-in day{(signal.WaterFlaggedDays == 1 ? "" : "s")} and excluded them from the slope.";

        if (!allowAdaptation)
            return new(false, expenditure, null, 0, evidence, prefix + " Holding the accepted estimate until the next check-in.");
        if (logged.Length < 14 || coverage < .60 || window.Count(d => IsLogged(d) && d.Date >= today.AddDays(-7)) < 4)
            return new(false, expenditure, null, 0, evidence,
                prefix + " Holding: need at least 14 logged days, 60% coverage, and four logged days in the most recent seven.");
        if (retained.Count < 8 || span < 21 || firstHalf < 3 || secondHalf < 3 ||
            mostRecent is not {} recent || recent < today.AddDays(-4))
            return new(false, expenditure, null, 0, evidence,
                prefix + $" Holding: need eight retained weigh-ins spanning 21 days, with three in each half and one within four days. Current evidence: {retained.Count} weigh-ins spanning {span} days.");
        if (signal.EndpointSlopeKgPerDay is not {} endpoint || signal.TheilSenSlopeKgPerDay is not {} theil)
            return new(false, expenditure, null, 0, evidence,
                prefix + " Holding: the retained weights do not cover both ends of the window.");
        if (Math.Abs(theil - endpoint) * 7 > .15)
            return new(false, expenditure, null, 0, evidence,
                prefix + " Holding: the trend and endpoint slopes disagree by more than 0.15 kg per week, so a level shift may still be inside the window.");

        var observed = evidence.MeanIntake - 7700 * theil;
        if (observed < 1000 || observed > 7000)
            return new(false, expenditure, observed, 0, evidence,
                prefix + " Holding: the observed estimate is outside the supported range. Review portions and weight entries.");
        var updated = expenditure + gain * (observed - expenditure);
        return new(true, updated, observed, gain, evidence,
            prefix + $" Based on {retained.Count} retained weigh-ins. The expenditure estimate moves {gain:P0} toward the observed intake/weight relationship. This is a provisional estimate, not a metabolic measurement.");
    }

    private static bool IsLogged(NutritionDay day) => day.Status is "complete" or "fasting";
}
