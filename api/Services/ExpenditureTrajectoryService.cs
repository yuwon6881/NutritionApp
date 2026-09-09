using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed class ExpenditureTrajectoryService(AppDb db)
{
    public const int BackfillDays = 90;

    public async Task<IReadOnlyList<DailyExpenditureEstimate>> EnsureThroughToday(CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var snapshots = await EnsureThroughTodayUnderLock(ct);
        await gate.Commit(ct);
        return snapshots;
    }

    internal async Task<IReadOnlyList<DailyExpenditureEstimate>> EnsureThroughTodayUnderLock(CancellationToken ct)
    {
        var user = await db.Users.SingleAsync(item => item.Id == db.CurrentUser, ct);
        if (string.IsNullOrWhiteSpace(user.ProfileJson)) return [];
        var profile = Json.Read<Profile>(user.ProfileJson);
        var today = Today(profile);
        var start = today.AddDays(-(BackfillDays - 1));
        var sourceRevision = SourceRevision(user);
        var existing = await db.ExpenditureEstimates.AsNoTracking().OrderBy(item => item.Date).ToListAsync(ct);
        var expected = Enumerable.Range(0, BackfillDays).Select(offset => start.AddDays(offset)).ToArray();
        var complete = existing.Count >= BackfillDays
            && existing.First().Date <= start
            && existing.Last().Date >= today
            && expected.All(date => existing.Any(item => item.Date == date))
            && existing.Where(item => item.Date >= start && item.Date <= today)
                .All(item => item.SourceRevision == sourceRevision && item.AlgorithmVersion == ExpenditureTrajectory.AlgorithmVersion);
        if (!complete)
        {
            await RebuildFromUnderLock(start, sourceRevision, ct);
            await db.SaveChangesAsync(ct);
        }
        return await db.ExpenditureEstimates.AsNoTracking().OrderBy(item => item.Date).ToListAsync(ct);
    }

    public async Task RebuildFrom(DateOnly from, long sourceRevision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        await RebuildFromUnderLock(from, sourceRevision, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    internal async Task RebuildFromUnderLock(DateOnly from, long sourceRevision, CancellationToken ct)
    {
        var user = await db.Users.SingleAsync(item => item.Id == db.CurrentUser, ct);
        if (string.IsNullOrWhiteSpace(user.ProfileJson)) return;
        var profile = Json.Read<Profile>(user.ProfileJson);
        var today = Today(profile);
        var start = from > today ? today : from;
        var seed = await db.ExpenditureEstimates.AsNoTracking()
            .Where(item => item.Date < start && item.AlgorithmVersion == ExpenditureTrajectory.AlgorithmVersion)
            .OrderByDescending(item => item.Date)
            .FirstOrDefaultAsync(ct);
        var previous = seed?.Expenditure ?? await StartingExpenditure(profile, start, ct);
        var days = await LoadDays(start.AddDays(-28), today, today, ct);
        var weights = await db.Weights
            .Where(weight => !weight.Deleted && weight.Date >= start.AddDays(-56) && weight.Date <= today)
            .OrderBy(weight => weight.Date)
            .Select(weight => new WeightPoint(weight.Date, weight.Kg))
            .ToListAsync(ct);

        foreach (var tracked in db.ChangeTracker.Entries<DailyExpenditureEstimate>().ToList())
            tracked.State = EntityState.Detached;
        await db.ExpenditureEstimates.Where(item => item.Date >= start).ExecuteDeleteAsync(ct);
        for (var date = start; date <= today; date = date.AddDays(1))
        {
            var point = ExpenditureTrajectory.Calculate(profile, date, days, weights, previous);
            db.ExpenditureEstimates.Add(new DailyExpenditureEstimate
            {
                UserId = user.Id,
                Date = date,
                Expenditure = point.Expenditure,
                SuggestedCalories = point.SuggestedCalories,
                Confidence = point.Confidence,
                HoldReason = point.HoldReason,
                SourceRevision = sourceRevision,
                AlgorithmVersion = ExpenditureTrajectory.AlgorithmVersion,
                Observed = point.Observed,
                Gain = point.Gain,
                TrendWeightKg = point.TrendWeightKg,
                EffectiveGoal = point.EffectiveGoal,
                GoalRatePercent = point.GoalRatePercent
            });
            previous = point.Expenditure;
        }
    }

    public async Task<DailyExpenditureEstimate?> Latest(CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var latest = await LatestUnderLock(ct);
        await gate.Commit(ct);
        return latest;
    }

    internal async Task<DailyExpenditureEstimate?> LatestUnderLock(CancellationToken ct)
    {
        await EnsureThroughTodayUnderLock(ct);
        return await db.ExpenditureEstimates.AsNoTracking().OrderByDescending(item => item.Date).FirstOrDefaultAsync(ct);
    }

    private async Task<double> StartingExpenditure(Profile profile, DateOnly before, CancellationToken ct)
    {
        var plan = await db.Plans.Where(item => item.Date < before)
            .OrderByDescending(item => item.Date).ThenByDescending(item => item.Revision).FirstOrDefaultAsync(ct);
        if (plan != null)
        {
            var result = Json.Read<CoachResult>(plan.ResultJson);
            if (result.Expenditure is {} expenditure && double.IsFinite(expenditure)) return expenditure;
        }
        return profile.Maintenance ?? Coach.Resting(profile) * profile.Activity;
    }

    private async Task<List<NutritionDay>> LoadDays(DateOnly start, DateOnly end, DateOnly current, CancellationToken ct)
    {
        var statuses = await db.Days.Where(day => !day.Deleted && day.Date >= start && day.Date <= end)
            .ToListAsync(ct);
        var totals = await db.Entries.Where(entry => !entry.Deleted && entry.Date >= start && entry.Date <= end)
            .GroupBy(entry => entry.Date)
            .Select(group => new { Date = group.Key, Calories = group.Sum(entry => entry.Calories) })
            .ToDictionaryAsync(item => item.Date, item => item.Calories, ct);
        var dates = statuses.Select(day => day.Date).Union(totals.Keys).OrderBy(date => date);
        return dates.Select(date =>
        {
            var status = statuses.LastOrDefault(day => day.Date == date);
            var hasEntries = totals.ContainsKey(date);
            var resolved = status?.Status is "complete" or "fasting"
                ? status.Status
                : status?.Status == "not_logged" ? "not_logged" : hasEntries ? "complete" : "incomplete";
            return new NutritionDay(date, resolved, status?.Archived == true ? status.Calories : totals.GetValueOrDefault(date));
        }).ToList();
    }

    private static long SourceRevision(AppUser user)
        => user.TrajectoryRevision != 0 ? user.TrajectoryRevision : user.ProfileRevision;

    private static DateOnly Today(Profile profile)
        => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById(profile.TimeZone)));
}
