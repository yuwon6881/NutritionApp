using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public record Mutation(Guid Id, string Kind, Guid RecordId, long ExpectedRevision, JsonElement Data, bool Delete = false);
public record CoachingSettingsInput(int? CheckInWeekday = null, string? WeightUnit = null, string? EnergyUnit = null, string? HeightUnit = null, string? MissingDayAction = null, string? WeightGoalMetric = null);
public sealed class SyncService(AppDb db,StorageService? storage=null,RetentionService? retention=null,ExpenditureTrajectoryService? trajectory=null,GoogleHealthWeightSyncService? weightSync=null)
{
    public async Task<long> Apply(Mutation op, CancellationToken ct)
    {
        var uid = db.CurrentUser ?? throw new DomainException("Sign in again.", 401);
        Validation.Require(op.Id != Guid.Empty && op.RecordId != Guid.Empty, "Mutation identity is required.");
        var hash = AuthService.Hash(Json.Write(op));
        await using var gate = await MutationLock.Acquire(db, uid, ct);
        var receipt = await db.Receipts.SingleOrDefaultAsync(x => x.Id == op.Id, ct);
        if (receipt != null) { Validation.Require(receipt.Hash == hash, "Idempotency key reused for different data.", 409); return receipt.Revision; }
        var user = await db.Users.SingleAsync(u => u.Id == uid, ct);
        if(retention!=null&&op.Kind == "entry")
        {
            if(op.Data.TryGetProperty("date",out var date)) retention.RequireEditable(date.Deserialize<DateOnly>(),user.ProfileJson);
            if(op.Kind=="entry"&&await db.Entries.SingleOrDefaultAsync(e=>e.Id==op.RecordId,ct) is {} existingEntry) retention.RequireEditable(existingEntry.Date,user.ProfileJson);
        }
        // A dated record is read before the write replaces it: a move or a delete has to rebuild the
        // trajectory from the earliest date it touches, which the incoming payload alone cannot name.
        DateOnly? storedDate=null,mutatedDate=null;
        Weight? previousWeight=null;
        if(op.Kind is "entry" or "weight" or "day")
        {
            if(op.Kind=="weight")
            {
                previousWeight=await db.Weights.SingleOrDefaultAsync(w=>w.Id==op.RecordId,ct);
                storedDate=previousWeight?.Date;
            }
            else
                storedDate=op.Kind=="entry"
                    ? await db.Entries.Where(e=>e.Id==op.RecordId).Select(e=>(DateOnly?)e.Date).SingleOrDefaultAsync(ct)
                    : await db.Days.Where(d=>d.Id==op.RecordId).Select(d=>(DateOnly?)d.Date).SingleOrDefaultAsync(ct);
            if(op.Data.ValueKind==JsonValueKind.Object&&op.Data.TryGetProperty("date",out var dateValue)&&dateValue.ValueKind==JsonValueKind.String)
                mutatedDate=dateValue.Deserialize<DateOnly>();
        }
        if(op.Kind=="entry")
        {
            var requestedDate=mutatedDate??storedDate;
            Validation.Require(!await db.Days.AnyAsync(d=>d.Archived&&(d.Date==requestedDate||d.Date==storedDate),ct),
                "This day has already been summarized. Meal details are read-only. Your unsynced edit is retained locally for review.",409);
        }
        var revision = user.Revision + 1;
        DateOnly? trajectoryFrom = null;
        switch (op.Kind)
        {
            case "profile":
                Validation.Require(!op.Delete && op.ExpectedRevision == user.ProfileRevision, "Profile changed on another device. Review before retrying.", 409);
                var profile = op.Data.Deserialize<Profile>(Json.Options) ?? throw new DomainException("Profile is required.");
                if (profile.Sex == "male") profile = profile with { PregnancyOrBreastfeeding = false };
                Validation.Profile(profile); user.ProfileJson = Json.Write(profile); user.ProfileRevision = revision;
                trajectoryFrom = RetentionService.Today(user.ProfileJson).AddDays(-(ExpenditureTrajectoryService.BackfillDays - 1));
                break;
            case "settings":
                Validation.Require(!op.Delete && op.ExpectedRevision == user.CoachingSettingsRevision, "Coaching settings changed on another device. Review before retrying.", 409);
                var settings = op.Data.Deserialize<CoachingSettingsInput>(Json.Options) ?? throw new DomainException("Coaching settings are required.");
                var weekday = settings.CheckInWeekday ?? user.CheckInWeekday;
                var weightUnit = settings.WeightUnit ?? user.WeightUnit;
                var energyUnit = settings.EnergyUnit ?? user.EnergyUnit;
                var heightUnit = settings.HeightUnit ?? user.HeightUnit;
                var missingDayAction = settings.MissingDayAction ?? user.MissingDayAction;
                var weightGoalMetric = settings.WeightGoalMetric ?? user.WeightGoalMetric;
                CheckInWeek.ValidateWeekday(weekday);
                Validation.Units(weightUnit, energyUnit, heightUnit);
                Validation.Require(missingDayAction is "ask" or "fasting" or "not_logged", "Choose a valid unlogged day setting.");
                Validation.Require(weightGoalMetric is "scale" or "trend", "Choose a valid weight goal metric.");
                user.CheckInWeekday = weekday;
                user.WeightUnit = weightUnit;
                user.EnergyUnit = energyUnit;
                user.HeightUnit = heightUnit;
                user.MissingDayAction = missingDayAction;
                user.WeightGoalMetric = weightGoalMetric;
                user.CoachingSettingsRevision = revision;
                user.CoachingSettingsChangedDate = RetentionService.Today(user.ProfileJson);
                break;
            case "entry": await Upsert<DiaryEntry>(op, revision, e =>
                {
                    Validation.Nutrients(e); Date(e.Date); Validation.Number(e.Quantity, .001, 100000, "Quantity");
                    Validation.Require(e.Time==null || System.Text.RegularExpressions.Regex.IsMatch(e.Time,@"\A(?:[01][0-9]|2[0-3]):[0-5][0-9]\z"),"Choose a valid meal time (HH:mm).");
                    Validation.Require(e.Unit is "g" or "serving", "Invalid unit.");
                    Validation.EntryPortion(e);
                }, ct); break;
            case "food":
                if(!op.Delete&&storage!=null) await storage.AllowOptional(ct);
                if(!op.Delete&&!await db.Foods.AnyAsync(f=>f.Id==op.RecordId,ct)) Validation.Require(await db.Foods.CountAsync(f=>!f.Deleted,ct)<1000,"The saved-food library limit is 1,000 records. Edit an existing food or log directly.",409);
                await Upsert<Food>(op, revision, f =>
                {
                    Validation.Nutrients(f); Validation.Number(f.ServingGrams, .1, 100000, "Serving weight");
                    Validation.Barcode(f.Barcode);
                    if (!string.IsNullOrWhiteSpace(f.Barcode))
                    {
                        var duplicate = db.Foods.Any(existing => !existing.Deleted && existing.Barcode == f.Barcode && existing.Id != op.RecordId);
                        Validation.Require(!duplicate, "That barcode is already linked to another saved food.", 409);
                    }
                    Validation.Require(f.IngredientsJson.Length <= 12000, "Recipe is too large.");
                    Validation.Portions(f.PortionsJson);
                    if (f.CookedYieldGrams is {} yield) Validation.Number(yield, 1, 100000, "Cooked yield");
                    using var recipe = JsonDocument.Parse(f.IngredientsJson);
                    Validation.Require(recipe.RootElement.ValueKind == JsonValueKind.Array, "Recipe ingredients must be a list.");
                }, ct); break;
            case "weight": await Upsert<Weight>(op, revision, w => { Date(w.Date); Validation.Number(w.Kg, 20, 400, "Weight"); }, ct); break;
            case "day":
                var savedDay=await db.Days.SingleOrDefaultAsync(d=>d.Id==op.RecordId,ct);
                Validation.Require(!(op.Delete && savedDay?.Archived == true),"Daily summaries cannot be deleted.",409);
                await Upsert<DayStatus>(op,revision,d=>
                {
                    Date(d.Date);
                    Validation.Require(savedDay==null || savedDay.Date==d.Date,"A day decision cannot be moved to another date.",409);
                    Validation.Require(d.Date < RetentionService.Today(user.ProfileJson) || d.Status == "incomplete","Today is still open for logging.");
                    Validation.Require(d.Status is "complete" or "incomplete" or "fasting" or "not_logged","Unknown day status.");
                    d.Archived=savedDay?.Archived??false;d.Calories=savedDay?.Calories??0;d.EntryCount=savedDay?.EntryCount??0;
                    d.Protein=savedDay?.Protein;d.Fat=savedDay?.Fat;d.Carbs=savedDay?.Carbs;d.Fiber=savedDay?.Fiber;
                },ct);break;
            default: throw new DomainException("Unknown record type.");
        }

        if (op.Kind is "entry" or "weight" or "day")
            trajectoryFrom = new[] { mutatedDate, storedDate }
                .Where(date => date != null).Select(date => date!.Value)
                .DefaultIfEmpty(RetentionService.Today(user.ProfileJson)).Min();
        // Food edits clear fasting or missing-intake decisions; elapsed dates resolve automatically.
        if (op.Kind == "entry")
        {
            var changed = db.ChangeTracker.Entries<DiaryEntry>().Single().Entity;
            var dates = new[] { changed.Date, db.Entry(changed).Property(x => x.Date).OriginalValue }.Distinct().ToArray();
            foreach (var date in dates)
            {
                var day = await db.Days.SingleOrDefaultAsync(d => d.Date == date, ct);
                if (day != null) { day.Status = "incomplete"; day.Revision = revision; }
            }
        }
        if (op.Kind == "day" && !op.Delete)
        {
            var day = db.ChangeTracker.Entries<DayStatus>().Single().Entity;
            if (day.Status == "fasting") Validation.Require(day.Calories == 0 && !await db.Entries.AnyAsync(e => e.Date == day.Date && !e.Deleted && e.Calories > 0, ct), "A fasting day cannot contain calories.");
        }
        user.Revision = revision;
        if (op.Kind == "food") user.FoodRevision = revision;
        if (op.Kind is "entry" or "day") user.DiaryRevision = revision;
        if(op.Kind=="weight"&&weightSync!=null)
            await weightSync.QueueMutationAsync(previousWeight,op,revision,ct);
        if (op.Kind is "profile" or "entry" or "weight" or "day")
        {
            user.TrajectoryRevision = revision;
            if (trajectory != null) await trajectory.RebuildFromUnderLock(trajectoryFrom ?? RetentionService.Today(user.ProfileJson), revision, ct, op.Kind == "profile");
        }
        db.Receipts.Add(new MutationReceipt { Id = op.Id, UserId = uid, Hash = hash, Revision = revision });
        await db.SaveChangesAsync(ct); await gate.Commit(ct); return revision;
    }

    private async Task Upsert<T>(Mutation op, long revision, Action<T> validate, CancellationToken ct) where T : OwnedRecord, new()
    {
        var existing = await db.Set<T>().SingleOrDefaultAsync(x => x.Id == op.RecordId, ct);
        Validation.Require((existing?.Revision ?? 0) == op.ExpectedRevision, "This record changed on another device. Review the conflict.", 409);
        Validation.Require(!op.Delete || existing != null, "Record no longer exists.", 409);
        if (op.Delete)
        {
            existing!.Deleted = true; existing.Revision = revision;
            if (existing is Food deletedFood) deletedFood.DeletedAt = DateTime.UtcNow;
            return;
        }
        var next = op.Data.Deserialize<T>(Json.Options) ?? throw new DomainException("Record is required.");
        if(next is DiaryEntry entry&&existing is DiaryEntry savedEntry&&!op.Data.TryGetProperty("time",out _))entry.Time=savedEntry.Time;
        if(next is DiaryEntry portionEntry&&existing is DiaryEntry savedPortionEntry)
        {
            if(!op.Data.TryGetProperty("portionLabel",out _)) portionEntry.PortionLabel=savedPortionEntry.PortionLabel;
            if(!op.Data.TryGetProperty("portionGrams",out _)) portionEntry.PortionGrams=savedPortionEntry.PortionGrams;
        }
        if(next is Food food&&existing is Food savedFood&&!op.Data.TryGetProperty("portionsJson",out _))
            food.PortionsJson=savedFood.PortionsJson;
        if(next is Food barcodeFood&&existing is Food savedBarcodeFood&&!op.Data.TryGetProperty("barcode",out _))
            barcodeFood.Barcode=savedBarcodeFood.Barcode;
        if(next is Food normalizedBarcodeFood)
            normalizedBarcodeFood.Barcode=string.IsNullOrWhiteSpace(normalizedBarcodeFood.Barcode)?null:normalizedBarcodeFood.Barcode.Trim();
        validate(next); next.Id = op.RecordId; next.UserId = db.CurrentUser!.Value; next.Revision = revision; next.Deleted = false;
        if (next is Food restoredFood) restoredFood.DeletedAt = null;
        if (existing == null) db.Set<T>().Add(next);
        else db.Entry(existing).CurrentValues.SetValues(next);
    }
    private static void Date(DateOnly date) => Validation.Require(date >= new DateOnly(2000,1,1) && date <= DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1), "Choose a date from 2000 through today.");
}
