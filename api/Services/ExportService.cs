using System.IO.Compression;
using System.Text;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public sealed record ExportSettings(
    int CheckInWeekday,
    long Revision,
    DateOnly? ChangedDate,
    string WeightUnit,
    string EnergyUnit,
    string HeightUnit);

public sealed record ExportRetention(
    int DetailDays,
    DateOnly DetailCutoff,
    IReadOnlyList<string> Notes);

public sealed record ExportPhoto(
    Guid Id,
    Guid SetId,
    DateOnly Date,
    string Angle,
    int Bytes,
    string Status,
    DateTime Created,
    string DownloadPath);

public sealed record NutritionExport(
    int SchemaVersion,
    DateTime ExportedAt,
    Profile? Profile,
    ExportSettings Settings,
    ExportRetention Retention,
    IReadOnlyList<DiaryEntry> Entries,
    IReadOnlyList<Food> Foods,
    IReadOnlyList<Weight> Weights,
    IReadOnlyList<DayStatus> Days,
    IReadOnlyList<AcceptedPlan> Plans,
    IReadOnlyList<CheckInDecision> CheckIns,
    IReadOnlyList<PhaseDecision> PhaseDecisions,
    IReadOnlyList<DailyExpenditureEstimate> ExpenditureEstimates,
    IReadOnlyList<ExportPhoto> PhysiquePhotos,
    IReadOnlyList<BodyRecordView> BodyRecords);

public sealed class ExportService(AppDb db, RetentionService retention)
{
    public async Task<NutritionExport> BuildJsonDocument(CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleAsync(item => item.Id == db.CurrentUser, ct);
        var profile = user.ProfileJson.Length == 0 ? null : Json.Read<Profile>(user.ProfileJson);
        var today = RetentionService.Today(user.ProfileJson);
        var detailDays = retention.DetailDays;
        var detailCutoff = RetentionService.Cutoff(today, detailDays);

        return new NutritionExport(
            SchemaVersion: 3,
            ExportedAt: DateTime.UtcNow,
            Profile: profile,
            Settings: new ExportSettings(user.CheckInWeekday, user.CoachingSettingsRevision, user.CoachingSettingsChangedDate, user.WeightUnit, user.EnergyUnit, user.HeightUnit),
            Retention: new ExportRetention(detailDays, detailCutoff, [
                "Meal detail before detailCutoff is removed by scheduled retention compaction.",
                "Archived days retain daily totals; deleted meal detail cannot be restored.",
                "Physique photo binaries are excluded; download_path is an authenticated metadata route."
            ]),
            Entries: await db.Entries.AsNoTracking().Where(item => !item.Deleted).OrderBy(item => item.Date).ThenBy(item => item.Time).ThenBy(item => item.Id).ToListAsync(ct),
            Foods: await db.Foods.AsNoTracking().Where(item => !item.Deleted).OrderBy(item => item.Name).ThenBy(item => item.Id).ToListAsync(ct),
            Weights: await db.Weights.AsNoTracking().Where(item => !item.Deleted).OrderBy(item => item.Date).ThenBy(item => item.Id).ToListAsync(ct),
            Days: await db.Days.AsNoTracking().Where(item => !item.Deleted).OrderBy(item => item.Date).ThenBy(item => item.Id).ToListAsync(ct),
            Plans: await db.Plans.AsNoTracking().Where(item => !item.Deleted).OrderBy(item => item.Date).ThenBy(item => item.Revision).ThenBy(item => item.Id).ToListAsync(ct),
            CheckIns: await db.CheckIns.AsNoTracking().Where(item => !item.Deleted).OrderBy(item => item.WeekStart).ThenBy(item => item.Date).ThenBy(item => item.Revision).ThenBy(item => item.Id).ToListAsync(ct),
            PhaseDecisions: await db.PhaseDecisions.AsNoTracking().Where(item => !item.Deleted).OrderBy(item => item.Date).ThenBy(item => item.ProfileRevision).ThenBy(item => item.Id).ToListAsync(ct),
            ExpenditureEstimates: await db.ExpenditureEstimates.AsNoTracking().OrderBy(item => item.Date).ThenBy(item => item.SourceRevision).ToListAsync(ct),
            PhysiquePhotos: await db.Photos.AsNoTracking().Where(item => !item.Deleted && item.Status == "complete")
                .OrderBy(item => item.Date).ThenBy(item => item.SetId).ThenBy(item => item.Angle).ThenBy(item => item.Id)
                .Select(item => new ExportPhoto(item.Id, item.SetId, item.Date, item.Angle, item.Bytes, item.Status, item.Created, $"/api/photos/{item.Id}/content"))
                .ToListAsync(ct),
            BodyRecords: await BuildBodyRecords(ct));
    }

    public async Task WriteCsvBundle(Stream output, CancellationToken ct)
    {
        var user = await db.Users.AsNoTracking().SingleAsync(item => item.Id == db.CurrentUser, ct);
        var today = RetentionService.Today(user.ProfileJson);
        var detailDays = retention.DetailDays;
        var detailCutoff = RetentionService.Cutoff(today, detailDays);
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);

        using var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true);
        counts["profile.csv"] = await WriteProfile(archive, user, ct);
        counts["entries.csv"] = await WriteEntries(archive, ct);
        counts["days.csv"] = await WriteDays(archive, ct);
        counts["weights.csv"] = await WriteWeights(archive, ct);
        counts["foods.csv"] = await WriteFoods(archive, ct);
        counts["plans.csv"] = await WritePlans(archive, ct);
        counts["check-ins.csv"] = await WriteCheckIns(archive, ct);
        counts["phase-decisions.csv"] = await WritePhaseDecisions(archive, ct);
        counts["expenditure-estimates.csv"] = await WriteExpenditureEstimates(archive, ct);
        counts["physique-photos.csv"] = await WritePhotos(archive, ct);
        counts["body-records.csv"] = await WriteBodyRecords(archive, ct);
        await WriteReadme(archive, counts, detailDays, detailCutoff, ct);
    }

    private static async Task<int> WriteProfile(ZipArchive archive, AppUser user, CancellationToken ct)
        => await WriteCsv(archive, "profile.csv", async writer =>
        {
            await writer.WriteAsync(Csv.Line(Csv.Field("key"), Csv.Field("value")));
            var rows = new (string Key, string? Value)[] {
                ("id", user.Id.ToString("D")),
                ("username", user.Username),
                ("revision", user.Revision.ToString(CultureInfo.InvariantCulture)),
                ("profile_revision", user.ProfileRevision.ToString(CultureInfo.InvariantCulture)),
                ("coaching_settings_revision", user.CoachingSettingsRevision.ToString(CultureInfo.InvariantCulture)),
                ("trajectory_revision", user.TrajectoryRevision.ToString(CultureInfo.InvariantCulture)),
                ("check_in_weekday", user.CheckInWeekday.ToString(CultureInfo.InvariantCulture)),
                ("coaching_settings_changed_date", user.CoachingSettingsChangedDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
                ("weight_unit", user.WeightUnit),
                ("energy_unit", user.EnergyUnit),
                ("height_unit", user.HeightUnit),
                ("profile_json", user.ProfileJson.Length == 0 ? null : user.ProfileJson)
            };
            foreach (var row in rows) await writer.WriteAsync(Csv.Line(Csv.Field(row.Key), Csv.Field(row.Value)));
            return rows.Length;
        }, ct);

    private async Task<int> WriteEntries(ZipArchive archive, CancellationToken ct)
        => await WriteCsv(archive, "entries.csv", async writer =>
        {
            await writer.WriteAsync(Csv.Line("id", "date", "time", "name", "quantity", "unit", "portion_label", "portion_grams", "calories", "protein_g", "fat_g", "carbs_g", "fiber_g", "source", "revision"));
            var count = 0;
            await foreach (var item in db.Entries.AsNoTracking().Where(entry => !entry.Deleted).OrderBy(entry => entry.Date).ThenBy(entry => entry.Time).ThenBy(entry => entry.Id).AsAsyncEnumerable().WithCancellation(ct))
            {
                await writer.WriteAsync(Csv.Line(Csv.Field(item.Id), Csv.Field(item.Date), Csv.Field(item.Time), Csv.Field(item.Name), Csv.Field(item.Quantity), Csv.Field(item.Unit), Csv.Field(item.PortionLabel), Csv.Field(item.PortionGrams), Csv.Field(item.Calories), Csv.Field(item.Protein), Csv.Field(item.Fat), Csv.Field(item.Carbs), Csv.Field(item.Fiber), Csv.Field(item.Source), Csv.Field(item.Revision)));
                count++;
            }
            return count;
        }, ct);

    private async Task<int> WriteDays(ZipArchive archive, CancellationToken ct)
        => await WriteCsv(archive, "days.csv", async writer =>
        {
            await writer.WriteAsync(Csv.Line("id", "date", "status", "archived", "entry_count", "calories", "protein_g", "fat_g", "carbs_g", "fiber_g", "revision"));
            var count = 0;
            await foreach (var item in db.Days.AsNoTracking().Where(day => !day.Deleted).OrderBy(day => day.Date).ThenBy(day => day.Id).AsAsyncEnumerable().WithCancellation(ct))
            {
                await writer.WriteAsync(Csv.Line(Csv.Field(item.Id), Csv.Field(item.Date), Csv.Field(item.Status), Csv.Field(item.Archived), Csv.Field(item.EntryCount), Csv.Field(item.Calories), Csv.Field(item.Protein), Csv.Field(item.Fat), Csv.Field(item.Carbs), Csv.Field(item.Fiber), Csv.Field(item.Revision)));
                count++;
            }
            return count;
        }, ct);

    private async Task<int> WriteWeights(ZipArchive archive, CancellationToken ct)
        => await WriteCsv(archive, "weights.csv", async writer =>
        {
            await writer.WriteAsync(Csv.Line("id", "date", "kg", "revision"));
            var count = 0;
            await foreach (var item in db.Weights.AsNoTracking().Where(weight => !weight.Deleted).OrderBy(weight => weight.Date).ThenBy(weight => weight.Id).AsAsyncEnumerable().WithCancellation(ct))
            {
                await writer.WriteAsync(Csv.Line(Csv.Field(item.Id), Csv.Field(item.Date), Csv.Field(item.Kg), Csv.Field(item.Revision)));
                count++;
            }
            return count;
        }, ct);

    private async Task<int> WriteFoods(ZipArchive archive, CancellationToken ct)
        => await WriteCsv(archive, "foods.csv", async writer =>
        {
            await writer.WriteAsync(Csv.Line("id", "name", "calories", "protein_g", "fat_g", "carbs_g", "fiber_g", "serving_grams", "portions_json", "ingredients_json", "cooked_yield_grams", "favourite", "source", "revision"));
            var count = 0;
            await foreach (var item in db.Foods.AsNoTracking().Where(food => !food.Deleted).OrderBy(food => food.Name).ThenBy(food => food.Id).AsAsyncEnumerable().WithCancellation(ct))
            {
                await writer.WriteAsync(Csv.Line(Csv.Field(item.Id), Csv.Field(item.Name), Csv.Field(item.Calories), Csv.Field(item.Protein), Csv.Field(item.Fat), Csv.Field(item.Carbs), Csv.Field(item.Fiber), Csv.Field(item.ServingGrams), Csv.Field(item.PortionsJson), Csv.Field(item.IngredientsJson), Csv.Field(item.CookedYieldGrams), Csv.Field(item.Favourite), Csv.Field(item.Source), Csv.Field(item.Revision)));
                count++;
            }
            return count;
        }, ct);

    private async Task<int> WritePlans(ZipArchive archive, CancellationToken ct)
        => await WriteCsv(archive, "plans.csv", async writer =>
        {
            await writer.WriteAsync(Csv.Line("id", "date", "input_revision", "profile_revision", "coaching_settings_revision", "check_in_weekday", "eligible", "adaptive", "calories", "expenditure", "protein_g", "fat_g", "carbs_g", "explanation", "version", "weekly_calories", "daily_calories", "goal_rate_percent", "effective_goal", "result_json"));
            var count = 0;
            await foreach (var item in db.Plans.AsNoTracking().Where(plan => !plan.Deleted).OrderBy(plan => plan.Date).ThenBy(plan => plan.Revision).ThenBy(plan => plan.Id).AsAsyncEnumerable().WithCancellation(ct))
            {
                var result = Json.Read<CoachResult>(item.ResultJson);
                await writer.WriteAsync(Csv.Line(Csv.Field(item.Id), Csv.Field(item.Date), Csv.Field(item.InputRevision), Csv.Field(item.ProfileRevision), Csv.Field(item.CoachingSettingsRevision), Csv.Field(item.CheckInWeekday), Csv.Field(result.Eligible), Csv.Field(result.Adaptive), Csv.Field(result.Calories), Csv.Field(result.Expenditure), Csv.Field(result.Protein), Csv.Field(result.Fat), Csv.Field(result.Carbs), Csv.Field(result.Explanation), Csv.Field(result.Version), Csv.Field(result.WeeklyCalories), Csv.Field(result.DailyCalories is null ? null : Json.Write(result.DailyCalories)), Csv.Field(result.GoalRatePercent), Csv.Field(result.EffectiveGoal), Csv.Field(item.ResultJson)));
                count++;
            }
            return count;
        }, ct);

    private async Task<int> WriteCheckIns(ZipArchive archive, CancellationToken ct)
        => await WriteCsv(archive, "check-ins.csv", async writer =>
        {
            await writer.WriteAsync(Csv.Line("id", "week_start", "check_in_weekday", "date", "decision", "input_revision", "result_json", "revision"));
            var count = 0;
            await foreach (var item in db.CheckIns.AsNoTracking().Where(checkIn => !checkIn.Deleted).OrderBy(checkIn => checkIn.WeekStart).ThenBy(checkIn => checkIn.Date).ThenBy(checkIn => checkIn.Revision).ThenBy(checkIn => checkIn.Id).AsAsyncEnumerable().WithCancellation(ct))
            {
                await writer.WriteAsync(Csv.Line(Csv.Field(item.Id), Csv.Field(item.WeekStart), Csv.Field(item.CheckInWeekday), Csv.Field(item.Date), Csv.Field(item.Decision), Csv.Field(item.InputRevision), Csv.Field(item.ResultJson), Csv.Field(item.Revision)));
                count++;
            }
            return count;
        }, ct);

    private async Task<int> WritePhaseDecisions(ZipArchive archive, CancellationToken ct)
        => await WriteCsv(archive, "phase-decisions.csv", async writer =>
        {
            await writer.WriteAsync(Csv.Line("id", "date", "profile_revision", "reached_by", "decision", "revision"));
            var count = 0;
            await foreach (var item in db.PhaseDecisions.AsNoTracking().Where(decision => !decision.Deleted).OrderBy(decision => decision.Date).ThenBy(decision => decision.ProfileRevision).ThenBy(decision => decision.Id).AsAsyncEnumerable().WithCancellation(ct))
            {
                await writer.WriteAsync(Csv.Line(Csv.Field(item.Id), Csv.Field(item.Date), Csv.Field(item.ProfileRevision), Csv.Field(item.ReachedBy), Csv.Field(item.Decision), Csv.Field(item.Revision)));
                count++;
            }
            return count;
        }, ct);

    private async Task<int> WriteExpenditureEstimates(ZipArchive archive, CancellationToken ct)
        => await WriteCsv(archive, "expenditure-estimates.csv", async writer =>
        {
            await writer.WriteAsync(Csv.Line("date", "expenditure", "suggested_calories", "confidence", "hold_reason", "source_revision", "algorithm_version", "observed", "gain", "trend_weight_kg", "effective_goal", "goal_rate_percent"));
            var count = 0;
            await foreach (var item in db.ExpenditureEstimates.AsNoTracking().OrderBy(estimate => estimate.Date).ThenBy(estimate => estimate.SourceRevision).AsAsyncEnumerable().WithCancellation(ct))
            {
                await writer.WriteAsync(Csv.Line(Csv.Field(item.Date), Csv.Field(item.Expenditure), Csv.Field(item.SuggestedCalories), Csv.Field(item.Confidence), Csv.Field(item.HoldReason), Csv.Field(item.SourceRevision), Csv.Field(item.AlgorithmVersion), Csv.Field(item.Observed), Csv.Field(item.Gain), Csv.Field(item.TrendWeightKg), Csv.Field(item.EffectiveGoal), Csv.Field(item.GoalRatePercent)));
                count++;
            }
            return count;
        }, ct);

    private async Task<int> WritePhotos(ZipArchive archive, CancellationToken ct)
        => await WriteCsv(archive, "physique-photos.csv", async writer =>
        {
            await writer.WriteAsync(Csv.Line("id", "set_id", "date", "angle", "bytes", "status", "created_at", "download_path"));
            var count = 0;
            await foreach (var item in db.Photos.AsNoTracking().Where(photo => !photo.Deleted && photo.Status == "complete").OrderBy(photo => photo.Date).ThenBy(photo => photo.SetId).ThenBy(photo => photo.Angle).ThenBy(photo => photo.Id).AsAsyncEnumerable().WithCancellation(ct))
            {
                await writer.WriteAsync(Csv.Line(Csv.Field(item.Id), Csv.Field(item.SetId), Csv.Field(item.Date), Csv.Field(item.Angle), Csv.Field(item.Bytes), Csv.Field(item.Status), Csv.Field(item.Created), Csv.Field($"/api/photos/{item.Id}/content")));
                count++;
            }
            return count;
        }, ct);

    private static async Task WriteReadme(ZipArchive archive, IReadOnlyDictionary<string, int> counts, int detailDays, DateOnly detailCutoff, CancellationToken ct)
    {
        var entry = archive.CreateEntry("README.txt", CompressionLevel.Fastest);
        await using var stream = entry.Open();
        await using var writer = new StreamWriter(stream, new UTF8Encoding(false), 1024, leaveOpen: false);
        await writer.WriteAsync("NutritionApp CSV export\r\n");
        await writer.WriteAsync("csvSchemaVersion=3\r\n\r\n");
        await writer.WriteAsync("Files use RFC 4180 commas and CRLF line endings. CSV files are UTF-8 with a BOM for spreadsheet compatibility.\r\n");
        await writer.WriteAsync("Null values are empty cells. Text beginning with =, +, -, @, tab, or carriage return is prefixed with an apostrophe.\r\n");
        await writer.WriteAsync("Dates use yyyy-MM-dd; timestamps use yyyy-MM-ddTHH:mm:ssZ; numeric values are invariant round-trip values.\r\n");
        await writer.WriteAsync("weights.csv is always kilograms, regardless of the account display preference.\r\n");
        await writer.WriteAsync("body-records.csv uses canonical centimetres and kilograms. Body fat uses percent; blank measurements and snapshots are unknown. Photo set_id is the Body record id; photo_ids includes pending relationships. Frozen weight source dates, capture time, provenance and calculation version are exported unchanged.\r\n");
        await writer.WriteAsync($"Meal-level detail is retained for {detailDays} days from {detailCutoff:yyyy-MM-dd}; earlier dates export as daily totals only because detail was deleted on schedule.\r\n");
        await writer.WriteAsync("Physique photo binaries are excluded. physique-photos.csv includes metadata and authenticated download paths.\r\n\r\n");
        await writer.WriteAsync("Data rows per file:\r\n");
        foreach (var pair in counts) await writer.WriteAsync($"{pair.Key}: {pair.Value}\r\n");
        await writer.FlushAsync(ct);
    }

    private static async Task<int> WriteCsv(ZipArchive archive, string name, Func<StreamWriter, Task<int>> write, CancellationToken ct)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Fastest);
        await using var stream = entry.Open();
        await using var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true), 1024, leaveOpen: false);
        ct.ThrowIfCancellationRequested();
        var count = await write(writer);
        await writer.FlushAsync(ct);
        return count;
    }

    private async Task<IReadOnlyList<BodyRecordView>> BuildBodyRecords(CancellationToken ct)
    {
        var records=await db.BodyRecords.AsNoTracking().Where(b=>!b.Deleted).OrderBy(b=>b.Date).ThenBy(b=>b.CreationOrder).ToListAsync(ct);
        var photos=await db.Photos.AsNoTracking().Where(p=>!p.Deleted).ToListAsync(ct);
        var bySet=photos.ToLookup(p=>p.SetId);
        return records.Select(b=>BodyRecordService.View(b,bySet[b.Id])).ToList();
    }

    private async Task<int> WriteBodyRecords(ZipArchive archive,CancellationToken ct)
        =>await WriteCsv(archive,"body-records.csv",async writer=>
        {
            var fields=BodyRecordService.MeasurementFields.ToArray();
            var names=fields.Select(field=>System.Text.RegularExpressions.Regex.Replace(field.Key,"[A-Z]",match=>"_"+match.Value.ToLowerInvariant()));
            await writer.WriteAsync(Csv.Line(new[]{"id","date","creation_order","revision","created_at","updated_at"}.Concat(names)
                .Concat(new[]{"scale_kg","scale_source_date","trend_kg","trend_source_date","snapshot_captured_at","calculation_version","provenance","photo_ids"}).ToArray()));
            var records=await BuildBodyRecords(ct);
            foreach(var body in records)
            {
                var snapshot=body.WeightContext;
                await writer.WriteAsync(Csv.Line(new[]{Csv.Field(body.Id),Csv.Field(body.Date),Csv.Field(body.CreationOrder),Csv.Field(body.Revision),Csv.Field(body.Created),Csv.Field(body.Updated)}
                    .Concat(fields.Select(field=>Csv.Field((double?)field.Value.GetValue(body.Measurements))))
                    .Concat(new[]{Csv.Field(snapshot.ScaleKg),Csv.Field(snapshot.ScaleDate),Csv.Field(snapshot.TrendKg),Csv.Field(snapshot.TrendDate),Csv.Field(snapshot.CapturedAt),Csv.Field(snapshot.CalculationVersion),Csv.Field(snapshot.Provenance),Csv.Field(string.Join(";",body.Photos.Select(p=>p.Id)))}).ToArray()));
            }
            return records.Count;
        },ct);
}
