namespace Nutrition.Api.Domain;

public record EnergyEvidence(int WindowDays, int LoggedDays, double Coverage, int WeighIns,
    int WeighInSpanDays, double MeanIntake, double SlopeKgPerDay, double NoiseKg,
    int WaterFlaggedDays, double Confidence)
{
    public int ContextExcluded { get; init; }
    public int ContextReinstated { get; init; }
    public int ContextSettling { get; init; }
}

public record ExpenditureEstimate(bool Adaptive, double Expenditure, double? Observed,
    double Gain, EnergyEvidence Evidence, string Reason);

public static class Expenditure
{
    public const int WindowDays = 28;
    /// Diary days a caller must load before today: the window plus the history intake-step
    /// detection compares against at the window's leading edge.
    public const int HistoryDays = WindowDays + IntakeStep.LookbackDays;
    private const int MinimumSettledWindowDays = 14;

    public static double DailyGain(double weeklyGain)
        => 1 - Math.Pow(1 - Math.Clamp(weeklyGain, 0, .999999999), 1d / 7);

    public static ExpenditureEstimate EstimateDaily(IReadOnlyList<NutritionDay> days,
        IReadOnlyList<WeightPoint> weights, double expenditure, DateOnly today)
    {
        // A fasting decision is an intentional zero-intake day.  Keep the "fasting"
        // status so IsLogged includes it in mean-intake and coverage (at 0 kcal),
        // matching the accepted-plan estimator that never mutates the status.
        var trajectoryDays = days.Select(day => day.Status == "fasting"
            ? day with { Calories = 0 }
            : day).ToArray();
        var weekly = Estimate(trajectoryDays, weights, expenditure, today);
        if (!weekly.Adaptive || weekly.Observed is not {} observed)
            return weekly with { Gain = 0, Expenditure = expenditure };
        var gain = DailyGain(weekly.Gain);
        return weekly with { Gain = gain, Expenditure = expenditure + gain * (observed - expenditure) };
    }

    /// <summary>
    /// Uses the full 28-day window unless intake changed inside it. After a change, only the days after water and
    /// glycogen settled are used, because a constant 7,700 kcal/kg would read that shift as tissue.
    /// </summary>
    public static ExpenditureEstimate Estimate(IReadOnlyList<NutritionDay> days,
        IReadOnlyList<WeightPoint> weights, double expenditure, DateOnly today, bool allowAdaptation = true)
    {
        var start = today.AddDays(-WindowDays);
        var step = IntakeStep.Largest(days.Where(IsLogged), start, today);
        var settledFrom = step?.Date.AddDays(IntakeStep.SettleDays);
        if (step is null || settledFrom <= start)
            return EstimateWindow(days, weights, expenditure, today, allowAdaptation, WindowDays, "");

        var settled = today.DayNumber - settledFrom!.Value.DayNumber;
        var change = $"your intake changed by about {Math.Round(Math.Abs(step.ChangeKcal) / 10) * 10:0} kcal/day around {step.Date:MMM d}";
        if (settled >= MinimumSettledWindowDays)
            return EstimateWindow(days, weights, expenditure, today, allowAdaptation, settled,
                $" Using the {settled} days since {change} and water and glycogen settled.");
        var held = EstimateWindow(days, weights, expenditure, today, false, WindowDays, "");
        return held with
        {
            Reason = held.Reason.Replace(HoldAccepted, "")
                + $" Holding: {change}. Water and glycogen shift for about a week after that, so the estimate waits for {MinimumSettledWindowDays} settled days."
        };
    }

    internal const string HoldAccepted = " Holding the accepted estimate until the next check-in.";

    private static ExpenditureEstimate EstimateWindow(IReadOnlyList<NutritionDay> days,
        IReadOnlyList<WeightPoint> weights, double expenditure, DateOnly today, bool allowAdaptation, int windowDays, string windowNote)
    {
        var start = today.AddDays(-windowDays);
        var scale = windowDays / (double)WindowDays;
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
        var minimumLogged = (int)Math.Ceiling(14 * scale);
        var minimumWeighIns = Math.Max(5, (int)Math.Ceiling(8 * scale));
        var minimumSpan = (int)Math.Ceiling(21 * scale);
        var coverageFactor = Math.Clamp(coverage / .85, 0, 1);
        var densityFactor = Math.Clamp(retained.Count / (windowDays / 2d), 0, 1);
        var precisionFactor = Math.Clamp(1 - signal.NoiseKg / .8, .5, 1);
        // A shorter settled window carries less evidence than the full four weeks.
        var confidence = coverageFactor * densityFactor * precisionFactor * scale;
        var gain = Math.Clamp(.25 * confidence, .08, .30);
        var evidence = new EnergyEvidence(windowDays, logged.Length, coverage, retained.Count, span,
            logged.Length == 0 ? 0 : logged.Average(d => d.Calories), signal.TheilSenSlopeKgPerDay ?? 0,
            signal.NoiseKg, signal.WaterFlaggedDays, confidence)
        {
            ContextExcluded = signal.ContextExcluded,
            ContextReinstated = signal.ContextReinstated,
            ContextSettling = signal.ContextSettling,
        };

        var prefix = $"{logged.Length} of {windowDays} days logged; unlogged days are excluded and may bias this estimate." +
            (windowDays == WindowDays ? " The 28-day window spans a full menstrual cycle." : windowNote);
        if (signal.ContextExcluded > 0)
            prefix += $" Excluded {Plural(signal.ContextExcluded, "weigh-in day")} you marked as a possible temporary fluctuation from the calorie trend.";
        if (signal.ContextSettling > 0)
            prefix += $" Counted {Plural(signal.ContextSettling, "later weigh-in")} at reduced weight while water settled.";
        if (signal.ContextReinstated > 0)
            prefix += $" Counted {Plural(signal.ContextReinstated, "marked weigh-in day")} again because later weigh-ins stayed at that level.";
        if (signal.WaterFlaggedDays > 0)
            prefix += $" Flagged {Plural(signal.WaterFlaggedDays, "possible water or level-shift weigh-in day")} and excluded {(signal.WaterFlaggedDays == 1 ? "it" : "them")} from the slope.";

        if (!allowAdaptation)
            return new(false, expenditure, null, 0, evidence, prefix + HoldAccepted);
        if (logged.Length < minimumLogged || coverage < .60 || window.Count(d => IsLogged(d) && d.Date >= today.AddDays(-7)) < 4)
            return new(false, expenditure, null, 0, evidence,
                prefix + $" Holding: need at least {minimumLogged} logged days, 60% coverage, and four logged days in the most recent seven.");
        if (retained.Count < minimumWeighIns || span < minimumSpan || firstHalf < 3 || secondHalf < 3 ||
            mostRecent is not {} recent || recent < today.AddDays(-4))
            return new(false, expenditure, null, 0, evidence,
                prefix + $" Holding: need {Words(minimumWeighIns)} retained weigh-ins spanning {minimumSpan} days, with three in each half and one within four days. Current evidence: {retained.Count} weigh-ins spanning {span} days.");
        if (signal.EndpointSlopeKgPerDay is not {} endpoint || signal.TheilSenSlopeKgPerDay is not {} theil)
            return new(false, expenditure, null, 0, evidence,
                prefix + " Holding: the retained weights do not cover both ends of the window.");
        if (Math.Abs(theil - endpoint) > signal.EndpointLimitKgPerDay)
            return new(false, expenditure, null, 0, evidence,
                prefix + $" Holding: the trend and endpoint slopes disagree by more than {signal.EndpointLimitKgPerDay * 7:0.##} kg per week, so a level shift may still be inside the window.");

        var observed = evidence.MeanIntake - 7700 * theil;
        if (observed < 1000 || observed > 7000)
            return new(false, expenditure, observed, 0, evidence,
                prefix + " Holding: the observed estimate is outside the supported range. Review portions and weight entries.");
        var updated = expenditure + gain * (observed - expenditure);
        return new(true, updated, observed, gain, evidence,
            prefix + $" Based on {retained.Count} retained weigh-ins. The expenditure estimate moves {gain:P0} toward the observed intake/weight relationship. This is a provisional estimate, not a metabolic measurement.");
    }

    private static string Plural(int count, string noun) => $"{count} {noun}{(count == 1 ? "" : "s")}";

    private static string Words(int count) => count switch { 5 => "five", 6 => "six", 7 => "seven", 8 => "eight", _ => count.ToString() };

    private static bool IsLogged(NutritionDay day) => day.Status is "complete" or "fasting";
}
