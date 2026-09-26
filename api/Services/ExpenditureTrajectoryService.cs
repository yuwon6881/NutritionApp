using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed class ExpenditureTrajectoryService(AppDb db)
{
    public const int BackfillDays = 90;

    public async Task<IReadOnlyList<DailyExpenditureEstimate>> EnsureThroughToday(CancellationToken ct)
    {
        // The common path is a read of the already complete 90-day window. Avoid
        // taking the account mutation lock (and its connection) for that case;
        // only a missing/stale window needs a serialized rebuild.
        var complete = await TryReadComplete(ct);
        if (complete is not null) return complete;
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        var snapshots = await EnsureThroughTodayUnderLock(ct);
        await gate.Commit(ct);
        return snapshots;
    }

    private async Task<IReadOnlyList<DailyExpenditureEstimate>?> TryReadComplete(CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleAsync(item => item.Id == db.CurrentUser, ct);
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
        return complete ? Retained(existing, start) : null;
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
        var retained = await db.ExpenditureEstimates.AsNoTracking().Where(item => item.Date >= start)
            .OrderBy(item => item.Date).ToListAsync(ct);
        var preceding = await db.ExpenditureEstimates.AsNoTracking().Where(item => item.Date < start)
            .OrderByDescending(item => item.Date).FirstOrDefaultAsync(ct);
        if (preceding is not null) retained.Insert(0, preceding);
        return retained;
    }

    public async Task RebuildFrom(DateOnly from, long sourceRevision, CancellationToken ct)
    {
        await using var gate = await MutationLock.Acquire(db, db.CurrentUser, ct);
        await RebuildFromUnderLock(from, sourceRevision, ct);
        await db.SaveChangesAsync(ct);
        await gate.Commit(ct);
    }

    internal async Task RebuildFromUnderLock(DateOnly from, long sourceRevision, CancellationToken ct, bool profileChanged = false)
    {
        var user = await db.Users.SingleAsync(item => item.Id == db.CurrentUser, ct);
        if (string.IsNullOrWhiteSpace(user.ProfileJson)) return;
        var profile = Json.Read<Profile>(user.ProfileJson);
        var today = Today(profile);
        // Only the backfill window is retained, so a mutation on a much older date rebuilds the
        // window rather than replaying every year since that date.
        var floor = today.AddDays(-(BackfillDays - 1));
        var start = from > today ? today : from < floor ? floor : from;
        var seed = profileChanged ? null : await db.ExpenditureEstimates.AsNoTracking()
            .Where(item => item.Date < start && item.AlgorithmVersion == ExpenditureTrajectory.AlgorithmVersion)
            .OrderByDescending(item => item.Date)
            .FirstOrDefaultAsync(ct);
        var previous = seed?.Expenditure ?? await StartingExpenditure(profile, start, ct, profileChanged);
        var days = await LoadDays(start.AddDays(-28), today, today, ct);
        var weights = await db.Weights
            .Where(weight => !weight.Deleted && weight.Date >= start.AddDays(-120) && weight.Date <= today)
            .OrderBy(weight => weight.Date)
            .Select(weight => new WeightPoint(weight.Date, weight.Kg, weight.Context))
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

    private async Task<double> StartingExpenditure(Profile profile, DateOnly before, CancellationToken ct, bool profileChanged = false)
    {
        var query = db.Plans.AsQueryable();
        if (!profileChanged) query = query.Where(item => item.Date < before);
        var plan = await query
            .OrderByDescending(item => item.Date).ThenByDescending(item => item.Revision).FirstOrDefaultAsync(ct);
        if (plan != null)
        {
            var result = Json.Read<CoachResult>(plan.ResultJson);
            var carried = GoalPolicy.CarryExpenditure(Json.Read<Profile>(plan.ProfileJson), profile, result.Expenditure);
            if (carried is {} expenditure && double.IsFinite(expenditure)) return expenditure;
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
            var hasFood = status?.Archived == true ? status.EntryCount > 0 : totals.ContainsKey(date);
            return new NutritionDay(date, LoggingDay.Status(date, current, status?.Status, hasFood),
                status?.Archived == true ? status.Calories : totals.GetValueOrDefault(date));
        }).ToList();
    }

    private static long SourceRevision(AppUser user)
        => user.TrajectoryRevision != 0 ? user.TrajectoryRevision : user.ProfileRevision;

    private static List<DailyExpenditureEstimate> Retained(IReadOnlyList<DailyExpenditureEstimate> rows, DateOnly start)
    {
        var result = rows.Where(row => row.Date >= start).OrderBy(row => row.Date).ToList();
        var preceding = rows.Where(row => row.Date < start).OrderByDescending(row => row.Date).FirstOrDefault();
        if (preceding is not null) result.Insert(0, preceding);
        return result;
    }

    private static DateOnly Today(Profile profile)
        => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById(profile.TimeZone)));
}
