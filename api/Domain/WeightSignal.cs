namespace Nutrition.Api.Domain;

/// <summary>One weigh-in context. Mirrors tests/fixtures/weight-context.json, which the web prompt also reads.</summary>
public sealed record WeightContextRule(string Code, bool Temporary, int SettleDays, string Direction);

/// <summary>How much a retained weigh-in counts, and why the context policy changed it.</summary>
public sealed record ContextResolution(IReadOnlyList<WeightPoint> Counted, IReadOnlyDictionary<DateOnly, double> Weights,
    IReadOnlyList<WeightPoint> Excluded, int Reinstated);

public static class WeightContextPolicy
{
    public const int ConfirmationDays = 7;
    public const int ConfirmingWeighIns = 3;
    public const double ConfirmationToleranceKg = .5;
    public const double MaxAdjustedShare = .3;

    public static readonly IReadOnlyList<WeightContextRule> Rules = [
        new("high_sodium", true, 2, "up"),
        new("high_carb", true, 3, "up"),
        new("alcohol", true, 2, "up"),
        new("poor_sleep", true, 1, "up"),
        new("stress", true, 1, "up"),
        new("hard_training", true, 2, "up"),
        new("bloating", true, 1, "up"),
        new("menstrual_cycle", true, 5, "up"),
        new("digestion", true, 1, "either"),
        new("dehydration", true, 1, "down"),
        new("low_carb", true, 3, "down"),
        new("illness", true, 3, "either"),
        new("travel", true, 2, "either"),
        new("other_temporary", true, 1, "either"),
        new("genuine_change", false, 0, "either"),
        new("unsure", false, 0, "either"),
    ];

    private static readonly Dictionary<string, WeightContextRule> ByCode = Rules.ToDictionary(rule => rule.Code);

    public static bool IsValid(string? context) => context is null || ByCode.ContainsKey(context);

    public static bool IsTemporary(string? context) => context is not null && ByCode.TryGetValue(context, out var rule) && rule.Temporary;

    /// <summary>Weigh-ins that count toward calorie estimation after marked days are resolved.</summary>
    public static IReadOnlyList<WeightPoint> ForCalorieEstimation(IEnumerable<WeightPoint> weights)
        => Resolve(weights.ToArray()).Counted;

    /// <summary>
    /// A temporary context excludes its own day and lets the following days return to full weight. A marked day is
    /// counted again once later unmarked weigh-ins show the weight stayed there, so a label cannot hide a real change.
    /// </summary>
    public static ContextResolution Resolve(IReadOnlyList<WeightPoint> weights)
    {
        var ordered = weights.OrderBy(weight => weight.Date).ToArray();
        var excluded = new List<WeightPoint>();
        var reinstated = 0;
        foreach (var point in ordered.Where(point => IsTemporary(point.Context)))
        {
            var later = ordered.Where(other => other.Date > point.Date
                    && other.Date.DayNumber - point.Date.DayNumber <= ConfirmationDays && !IsTemporary(other.Context))
                .Select(other => other.Kg).ToArray();
            if (later.Length >= ConfirmingWeighIns && Math.Abs(Statistics.Median(later) - point.Kg) <= ConfirmationToleranceKg)
                reinstated++;
            else
                excluded.Add(point);
        }
        return Build(ordered, excluded, reinstated);
    }

    /// <summary>Counts excluded marked days back in, least unusual first, until they are within the capped share.</summary>
    public static ContextResolution Cap(ContextResolution resolution, DateOnly start, DateOnly end)
    {
        var inWindow = resolution.Excluded.Where(point => point.Date >= start && point.Date < end).ToArray();
        var windowCount = resolution.Counted.Count(point => point.Date >= start && point.Date < end) + inWindow.Length;
        var allowed = (int)Math.Floor(windowCount * MaxAdjustedShare);
        if (inWindow.Length <= allowed) return resolution;
        var counted = resolution.Counted;
        double Deviation(WeightPoint point)
        {
            var nearby = counted.Where(other => Math.Abs(other.Date.DayNumber - point.Date.DayNumber) <= WeightSignal.WideHalfWindowDays)
                .Select(other => other.Kg).ToArray();
            return nearby.Length == 0 ? 0 : Math.Abs(point.Kg - Statistics.Median(nearby));
        }
        var restore = inWindow.OrderBy(Deviation).ThenBy(point => point.Date).Take(inWindow.Length - allowed).ToHashSet();
        var all = counted.Concat(resolution.Excluded).OrderBy(point => point.Date).ToArray();
        return Build(all, resolution.Excluded.Where(point => !restore.Contains(point)).ToList(), resolution.Reinstated + restore.Count);
    }

    private static ContextResolution Build(IReadOnlyList<WeightPoint> ordered, List<WeightPoint> excluded, int reinstated)
    {
        var excludedDates = excluded.Select(point => point.Date).ToHashSet();
        var counted = ordered.Where(point => !excludedDates.Contains(point.Date)).ToArray();
        var weights = new Dictionary<DateOnly, double>();
        foreach (var marked in excluded)
        {
            var settle = ByCode[marked.Context!].SettleDays;
            for (var day = 1; day <= settle; day++)
            {
                var date = marked.Date.AddDays(day);
                var weight = day / (settle + 1d);
                weights[date] = weights.TryGetValue(date, out var existing) ? Math.Min(existing, weight) : weight;
            }
        }
        return new(counted, weights, excluded, reinstated);
    }
}

public record WeightSignalResult(IReadOnlyList<WeightPoint> Retained, double NoiseKg,
    int WaterFlaggedDays, double? TheilSenSlopeKgPerDay, double? EndpointSlopeKgPerDay)
{
    /// <summary>Per retained weigh-in weight: below 1 while water settles after a marked day.</summary>
    public IReadOnlyList<double> RetainedWeights { get; init; } = [];
    /// <summary>Largest trend/endpoint disagreement explained by weigh-in noise alone.</summary>
    public double EndpointLimitKgPerDay { get; init; }
    public int ContextExcluded { get; init; }
    public int ContextReinstated { get; init; }
    public int ContextSettling { get; init; }
}

public static class WeightSignal
{
    public const int HalfWindowDays = 3;
    public const int WideHalfWindowDays = 7;
    public const int MinNeighbours = 3;
    public const double ThresholdSigma = 3;
    public const double NoiseFloorKg = .3;
    public const double MadScale = 1.4826;
    private const double MinimumDisagreementKgPerWeek = .15;

    public static WeightSignalResult Analyze(IReadOnlyList<WeightPoint> weights, DateOnly today, int windowDays = 28)
    {
        var start = today.AddDays(-windowDays);
        var resolution = WeightContextPolicy.Cap(WeightContextPolicy.Resolve(weights), start, today);
        var candidates = resolution.Counted.Where(point => point.Date <= today).ToArray();
        var (flags, noise) = Outliers(candidates, start, today);
        var inWindow = candidates.Where(point => point.Date >= start && point.Date < today).ToArray();
        var retained = inWindow.Where(point => !flags.Contains(point.Date)).ToArray();
        var retainedWeights = retained.Select(point => resolution.Weights.GetValueOrDefault(point.Date, 1)).ToArray();

        var first = retained.Where(point => point.Date < start.AddDays(7)).ToArray();
        var last = retained.Where(point => point.Date >= today.AddDays(-7)).ToArray();
        double? endpoint = null;
        var limit = MinimumDisagreementKgPerWeek / 7;
        if (first.Length > 0 && last.Length > 0)
        {
            var elapsed = Statistics.Median(last.Select(point => (double)point.Date.DayNumber).ToArray())
                - Statistics.Median(first.Select(point => (double)point.Date.DayNumber).ToArray());
            if (elapsed > 0)
            {
                endpoint = (Statistics.Median(last.Select(point => point.Kg).ToArray())
                    - Statistics.Median(first.Select(point => point.Kg).ToArray())) / elapsed;
                // A median's standard error is about 1.2533σ/√n; allow two standard errors of the difference.
                var standardError = 1.2533 * Math.Max(noise, .2) * Math.Sqrt(1d / first.Length + 1d / last.Length) / elapsed;
                limit = Math.Max(limit, 2 * standardError);
            }
        }
        var theil = retained.Length >= 2 ? (double?)Statistics.WeightedTheilSen(retained, retainedWeights) : null;
        return new(retained, noise, inWindow.Length - retained.Length, theil, endpoint)
        {
            RetainedWeights = retainedWeights,
            EndpointLimitKgPerDay = limit,
            ContextExcluded = resolution.Excluded.Count(point => point.Date >= start && point.Date < today),
            ContextReinstated = resolution.Reinstated,
            ContextSettling = retainedWeights.Count(weight => weight < 1),
        };
    }

    /// <summary>The smoothed trend without marked days or statistical outliers, shared by coaching and display.</summary>
    public static IReadOnlyList<WeightPoint> CleanTrend(IReadOnlyList<WeightPoint> weights, DateOnly today, int windowDays = 28)
    {
        var candidates = WeightContextPolicy.ForCalorieEstimation(weights).Where(point => point.Date <= today).ToArray();
        var (flags, _) = Outliers(candidates, today.AddDays(-windowDays), today);
        return Coach.Trend(candidates.Where(point => !flags.Contains(point.Date)).Select(point => point with { Context = null }).ToArray());
    }

    /// <summary>
    /// Hampel filter: each weigh-in is compared with the median of its neighbours (never itself), so a spike cannot
    /// soften its own test, while a sustained level shift matches its neighbours on one side and is kept.
    /// Noise comes from the recent window so years of history do not dilute the current scale's behaviour.
    /// </summary>
    private static (HashSet<DateOnly> Flags, double Noise) Outliers(IReadOnlyList<WeightPoint> points, DateOnly start, DateOnly end)
    {
        var residuals = new Dictionary<DateOnly, double>();
        for (var i = 0; i < points.Count; i++)
        {
            var neighbours = Neighbours(points, i, HalfWindowDays);
            if (neighbours.Length < MinNeighbours) neighbours = Neighbours(points, i, WideHalfWindowDays);
            if (neighbours.Length >= MinNeighbours) residuals[points[i].Date] = points[i].Kg - Statistics.Median(neighbours);
        }
        var recent = residuals.Where(item => item.Key >= start && item.Key < end).Select(item => item.Value).ToArray();
        var noise = MadScale * Statistics.MedianAbsoluteDeviation(recent);
        var threshold = ThresholdSigma * Math.Max(noise, NoiseFloorKg);
        return (residuals.Where(item => Math.Abs(item.Value) > threshold).Select(item => item.Key).ToHashSet(), noise);
    }

    private static double[] Neighbours(IReadOnlyList<WeightPoint> points, int index, int halfWindow)
    {
        var day = points[index].Date.DayNumber;
        var result = new List<double>();
        for (var j = index - 1; j >= 0 && day - points[j].Date.DayNumber <= halfWindow; j--) result.Add(points[j].Kg);
        for (var j = index + 1; j < points.Count && points[j].Date.DayNumber - day <= halfWindow; j++) result.Add(points[j].Kg);
        return result.ToArray();
    }
}

internal static class Statistics
{
    public static double Median(IReadOnlyList<double> values)
    {
        var sorted = values.OrderBy(value => value).ToArray();
        if (sorted.Length == 0) return 0;
        return sorted.Length % 2 == 1
            ? sorted[sorted.Length / 2]
            : (sorted[sorted.Length / 2 - 1] + sorted[sorted.Length / 2]) / 2;
    }

    public static double MedianAbsoluteDeviation(IReadOnlyList<double> values)
    {
        if (values.Count == 0) return 0;
        var center = Median(values);
        return Median(values.Select(value => Math.Abs(value - center)).ToArray());
    }

    /// <summary>Theil–Sen slope where each pair counts by the product of its point weights.</summary>
    public static double WeightedTheilSen(IReadOnlyList<WeightPoint> points, IReadOnlyList<double> weights)
    {
        var slopes = new List<(double Slope, double Weight)>();
        for (var i = 0; i < points.Count; i++)
            for (var j = i + 1; j < points.Count; j++)
            {
                var days = points[j].Date.DayNumber - points[i].Date.DayNumber;
                var weight = weights[i] * weights[j];
                if (days != 0 && weight > 0) slopes.Add(((points[j].Kg - points[i].Kg) / days, weight));
            }
        if (slopes.Count == 0) return 0;
        slopes.Sort((a, b) => a.Slope.CompareTo(b.Slope));
        var half = slopes.Sum(item => item.Weight) / 2;
        var cumulative = 0d;
        for (var k = 0; k < slopes.Count; k++)
        {
            cumulative += slopes[k].Weight;
            // An exact half-way split averages the two middle slopes, matching the unweighted median.
            if (Math.Abs(cumulative - half) < 1e-12 && k + 1 < slopes.Count) return (slopes[k].Slope + slopes[k + 1].Slope) / 2;
            if (cumulative > half) return slopes[k].Slope;
        }
        return slopes[^1].Slope;
    }
}
