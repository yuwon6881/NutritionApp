using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record ProgressGrouping(string Weight, string Energy);
public sealed record ProgressWeightPoint(DateOnly Date, double ScaleKg, double TrendKg);
public sealed record ProgressWeightStatistics(int Count, double? AverageKg, double? MinimumKg, double? MaximumKg, double? FirstKg, double? LatestKg, double? LatestTrendKg, double? TrendChangeKg);
public sealed record ProgressWeightSummary(ProgressWeightStatistics Statistics, IReadOnlyList<ProgressWeightPoint> Series, IReadOnlyList<Weight> EditableWeighIns);
public sealed record ProgressEnergyBucket(DateOnly Date, DateOnly End, double? Intake, double? Maintenance, double? Balance, bool Complete, int Days, int LoggedDays);
public sealed record ProgressEnergyStatistics(int Days, int LoggedDays, int CompleteDays, double? TotalIntake, double? AverageIntake, double? AverageMaintenance, double? TotalBalance, int SurplusDays, int DeficitDays);
public sealed record ProgressEnergySummary(ProgressEnergyStatistics Statistics, IReadOnlyList<ProgressEnergyBucket> Series);
public sealed record ProgressSummaryResponse(string Period, DateOnly Start, DateOnly End, long Revision, ProgressGrouping Grouping, ProgressWeightSummary Weight, ProgressEnergySummary Energy, bool AwaitingSynchronization = false);

/// <summary>
/// Builds the long-range progress contract without loading diary meal detail.
/// Archived day totals and grouped database aggregates are sufficient for energy
/// history; the shared trend uses all preceding weigh-ins before reducing its display series.
/// </summary>
public sealed class ProgressSummaryService(AppDb db, ExpenditureTrajectoryService trajectory, IMemoryCache cache)
{
    public static readonly string[] Periods = ["week", "month", "six-months", "year", "all"];

    public async Task<ProgressSummaryResponse> Get(string? requestedPeriod, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleAsync(item => item.Id == db.CurrentUser, ct);
        var profile = string.IsNullOrWhiteSpace(user.ProfileJson) ? null : Json.Read<Profile>(user.ProfileJson);
        var current = RetentionService.Today(user.ProfileJson);
        var period = NormalizePeriod(requestedPeriod);
        var earliest = period == "all" ? await EarliestRelevantDate(current, ct) : current;
        var (start, end) = ResolveRange(period, current, earliest);
        var key = $"progress:{user.Id:N}:{period}:{start:yyyyMMdd}:{end:yyyyMMdd}:{user.Revision}:{user.TrajectoryRevision}";
        if (cache.TryGetValue(key, out ProgressSummaryResponse? cached) && cached is not null) return cached;

        var snapshots = profile is null ? [] : await trajectory.EnsureThroughToday(ct);
        var weight = await BuildWeightSummary(start, end, ct);
        var energy = await BuildEnergySummary(period, start, end, current, snapshots, ct);
        var result = new ProgressSummaryResponse(
            period,
            start,
            end,
            user.Revision,
            new ProgressGrouping("daily", EnergyGrouping(period, start, end)),
            weight,
            energy);
        cache.Set(key, result, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2),
            Size = 1
        });
        return result;
    }

    public static string NormalizePeriod(string? value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "week" or "last-week" or "7" => "week",
            "month" or "last-month" or "recent" or "28" or "30" => "month",
            "six-months" or "six-month" or "6-months" or "half-year" or "six" => "six-months",
            "year" or "one-year" or "12-months" => "year",
            "all" or "full" => "all",
            _ => "month"
        };
    }

    public static (DateOnly Start, DateOnly End) ResolveRange(string period, DateOnly today, DateOnly? earliest = null)
    {
        var normalized = NormalizePeriod(period);
        var end = today;
        var start = normalized switch
        {
            "week" => end.AddDays(-6),
            // A month is a calendar interval: subtract a clamped month, then
            // start on the following day. This keeps March 31 -> March 1.
            "month" => end.AddMonths(-1).AddDays(1),
            "six-months" => end.AddMonths(-6).AddDays(1),
            "year" => end.AddYears(-1).AddDays(1),
            "all" => earliest ?? end,
            _ => end.AddMonths(-1).AddDays(1)
        };
        return (start < new DateOnly(2000, 1, 1) ? new DateOnly(2000, 1, 1) : start, end);
    }

    public static string EnergyGrouping(string period, DateOnly start, DateOnly end)
    {
        var normalized = NormalizePeriod(period);
        if (normalized is "week" or "month") return "daily";
        if (normalized == "six-months") return "weekly";
        if (normalized == "year") return "monthly";
        var days = end.DayNumber - start.DayNumber + 1;
        return days <= 31 ? "daily" : days <= 186 ? "weekly" : "monthly";
    }

    private async Task<DateOnly> EarliestRelevantDate(DateOnly fallback, CancellationToken ct)
    {
        var dates = db.Entries.Where(item => !item.Deleted).Select(item => item.Date)
            .Concat(db.Days.Where(item => !item.Deleted).Select(item => item.Date))
            .Concat(db.Weights.Where(item => !item.Deleted).Select(item => item.Date))
            .Concat(db.Plans.Where(item => !item.Deleted).Select(item => item.Date));
        var earliest = await dates.OrderBy(value => value).FirstOrDefaultAsync(ct);
        return earliest == default ? fallback : earliest;
    }

    private async Task<ProgressWeightSummary> BuildWeightSummary(DateOnly start, DateOnly end, CancellationToken ct)
    {
        // Smooth the same complete preceding history for every selected period.
        // A single raw seed changes the trend when the chart window changes.
        var history = await db.Weights.AsNoTracking()
            .Where(item => !item.Deleted && item.Date <= end)
            .OrderBy(item => item.Date)
            .Select(item => new WeightRow(item.Date, item.Kg))
            .ToListAsync(ct);
        var rows = history.Where(item => item.Date >= start).ToList();
        var smoothed = Coach.Trend(history.Select(item => new WeightPoint(item.Date, item.Kg)).ToList());
        var trendByDate = smoothed.ToDictionary(item => item.Date, item => item.Kg);
        var points = rows.Select(item => new ProgressWeightPoint(item.Date, item.Kg, trendByDate[item.Date])).ToList();
        var values = rows.Select(item => item.Kg).ToArray();
        var statistics = new ProgressWeightStatistics(
            values.Length,
            values.Length == 0 ? null : values.Average(),
            values.Length == 0 ? null : values.Min(),
            values.Length == 0 ? null : values.Max(),
            values.Length == 0 ? null : values[0],
            values.Length == 0 ? null : values[^1],
            points.Count == 0 ? null : points[^1].TrendKg,
            points.Count < 2 ? null : points[^1].TrendKg - points[0].TrendKg);
        var editable = await db.Weights.AsNoTracking()
            .Where(item => !item.Deleted && item.Date >= start && item.Date <= end)
            .OrderByDescending(item => item.Date)
            .Take(10)
            .ToListAsync(ct);
        return new ProgressWeightSummary(statistics, ReduceWeightSeries(points), editable);
    }

    private async Task<ProgressEnergySummary> BuildEnergySummary(
        string period,
        DateOnly start,
        DateOnly end,
        DateOnly current,
        IReadOnlyList<DailyExpenditureEstimate> snapshots,
        CancellationToken ct)
    {
        var archived = await db.Days.AsNoTracking()
            .Where(item => !item.Deleted && item.Date >= start && item.Date <= end)
            .ToDictionaryAsync(item => item.Date, ct);
        var totals = await db.Entries.AsNoTracking()
            .Where(item => !item.Deleted && item.Date >= start && item.Date <= end)
            .GroupBy(item => item.Date)
            .Select(group => new EntryTotal(group.Key, group.Sum(item => item.Calories), group.Count()))
            .ToDictionaryAsync(item => item.Date, ct);

        var planRows = await db.Plans.AsNoTracking()
            .Where(item => !item.Deleted && item.Date <= end)
            .OrderBy(item => item.Date).ThenBy(item => item.Revision)
            .Select(item => new PlanPoint(item.Date, item.Revision, item.ResultJson))
            .ToListAsync(ct);
        var maintenance = planRows.Select(item =>
        {
            var result = Json.Read<CoachResult>(item.ResultJson);
            return new MaintenancePoint(item.Date, item.Revision, result.Expenditure);
        }).Concat(snapshots.Where(item => item.Date <= end).Select(item => new MaintenancePoint(item.Date, item.SourceRevision, item.Expenditure)))
          .OrderBy(item => item.Date).ThenBy(item => item.Revision)
          .ToList();

        var daily = new List<ProgressEnergyBucket>();
        var cursor = 0;
        double? activeMaintenance = null;
        for (var date = start; date <= end; date = date.AddDays(1))
        {
            while (cursor < maintenance.Count && maintenance[cursor].Date <= date)
                activeMaintenance = maintenance[cursor++].Value;
            archived.TryGetValue(date, out var status);
            var hasFood = status?.Archived == true ? status.EntryCount > 0 : totals.ContainsKey(date);
            var resolved = LoggingDay.Status(date, current, status?.Status, hasFood);
            var complete = resolved is "complete" or "fasting";
            double? intake = status?.Archived == true
                ? (complete || status.EntryCount > 0 ? status.Calories : null)
                : totals.TryGetValue(date, out var total) ? total.Calories : complete ? 0 : null;
            daily.Add(new ProgressEnergyBucket(date, date, intake, activeMaintenance,
                complete && intake is not null && activeMaintenance is not null ? intake - activeMaintenance : null,
                complete, 1, intake is null ? 0 : 1));
        }

        var knownIntake = daily.Where(item => item.Intake is not null).Select(item => item.Intake!.Value).ToArray();
        var knownMaintenance = daily.Where(item => item.Maintenance is not null).Select(item => item.Maintenance!.Value).ToArray();
        var balances = daily.Where(item => item.Balance is not null).Select(item => item.Balance!.Value).ToArray();
        var stats = new ProgressEnergyStatistics(
            daily.Count,
            daily.Sum(item => item.LoggedDays),
            daily.Count(item => item.Complete),
            knownIntake.Length == 0 ? null : knownIntake.Sum(),
            knownIntake.Length == 0 ? null : knownIntake.Average(),
            knownMaintenance.Length == 0 ? null : knownMaintenance.Average(),
            balances.Length == 0 ? null : balances.Sum(),
            balances.Count(value => value > 0),
            balances.Count(value => value < 0));
        var grouped = GroupEnergy(daily, EnergyGrouping(period, start, end));
        return new ProgressEnergySummary(stats, grouped);
    }

    private static IReadOnlyList<ProgressWeightPoint> ReduceWeightSeries(IReadOnlyList<ProgressWeightPoint> points)
    {
        const int max = 400;
        if (points.Count <= max) return points;
        var keep = new HashSet<int> { 0, points.Count - 1 };
        foreach (var selector in new Func<ProgressWeightPoint, double>[] { item => item.ScaleKg, item => item.TrendKg })
        {
            keep.Add(Enumerable.Range(0, points.Count).MinBy(index => selector(points[index])));
            keep.Add(Enumerable.Range(0, points.Count).MaxBy(index => selector(points[index])));
        }
        var remaining = max - keep.Count;
        for (var i = 1; i <= remaining; i++)
            keep.Add((int)Math.Round(i * (points.Count - 1d) / (remaining + 1), MidpointRounding.AwayFromZero));
        return keep.OrderBy(index => index).Select(index => points[index]).ToList();
    }

    private static IReadOnlyList<ProgressEnergyBucket> GroupEnergy(IReadOnlyList<ProgressEnergyBucket> daily, string grouping)
    {
        if (grouping == "daily") return daily;
        var buckets = new List<List<ProgressEnergyBucket>>();
        var current = new List<ProgressEnergyBucket>();
        string? key = null;
        foreach (var item in daily)
        {
            var itemKey = grouping == "weekly" ? Monday(item.Date).ToString("yyyy-MM-dd") : $"{item.Date.Year:0000}-{item.Date.Month:00}";
            if (key is not null && itemKey != key) { buckets.Add(current); current = []; }
            key = itemKey; current.Add(item);
        }
        if (current.Count > 0) buckets.Add(current);
        if (buckets.Count > 120)
        {
            var size = (int)Math.Ceiling(buckets.Count / 120d);
            buckets = buckets.Chunk(size).Select(chunk => chunk.SelectMany(items => items).ToList()).ToList();
        }
        return buckets.Select(Combine).ToList();
    }

    private static ProgressEnergyBucket Combine(IReadOnlyList<ProgressEnergyBucket> items)
    {
        var intakes = items.Where(item => item.Intake is not null).Select(item => item.Intake!.Value).ToArray();
        var maintenance = items.Where(item => item.Maintenance is not null).Select(item => item.Maintenance!.Value).ToArray();
        var balances = items.Where(item => item.Balance is not null).Select(item => item.Balance!.Value).ToArray();
        return new ProgressEnergyBucket(
            items[0].Date,
            items[^1].End,
            intakes.Length == 0 ? null : intakes.Sum(),
            maintenance.Length == items.Count ? maintenance.Sum() : null,
            balances.Length == items.Count ? balances.Sum() : null,
            items.All(item => item.Complete),
            items.Sum(item => item.Days),
            items.Sum(item => item.LoggedDays));
    }

    private static DateOnly Monday(DateOnly date) => date.AddDays(-(((int)date.DayOfWeek + 6) % 7));

    private sealed record WeightRow(DateOnly Date, double Kg);
    private sealed record EntryTotal(DateOnly Date, double Calories, int Count);
    private sealed record PlanPoint(DateOnly Date, long Revision, string ResultJson);
    private sealed record MaintenancePoint(DateOnly Date, long Revision, double? Value);
}
