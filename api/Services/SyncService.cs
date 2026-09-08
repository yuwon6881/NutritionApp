using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;

namespace Nutrition.Api.Services;

public record Mutation(Guid Id, string Kind, Guid RecordId, long ExpectedRevision, JsonElement Data, bool Delete = false);
public sealed class SyncService(AppDb db,StorageService? storage=null,RetentionService? retention=null)
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
        var revision = user.Revision + 1;
        switch (op.Kind)
        {
            case "profile":
                Validation.Require(!op.Delete && op.ExpectedRevision == user.ProfileRevision, "Profile changed on another device. Review before retrying.", 409);
                var profile = op.Data.Deserialize<Profile>(Json.Options) ?? throw new DomainException("Profile is required.");
                Validation.Profile(profile); user.ProfileJson = Json.Write(profile); user.ProfileRevision = revision;
                break;
            case "entry": await Upsert<DiaryEntry>(op, revision, e =>
                {
                    Validation.Nutrients(e); Date(e.Date); Validation.Number(e.Quantity, .001, 100000, "Quantity");
                    Validation.Require(e.Meal.Length is > 0 and <= 80 && e.Unit is "g" or "serving", "Invalid meal or unit.");
                }, ct); break;
            case "food":
                if(!op.Delete&&storage!=null) await storage.AllowOptional(ct);
                if(!op.Delete&&!await db.Foods.AnyAsync(f=>f.Id==op.RecordId,ct)) Validation.Require(await db.Foods.CountAsync(ct)<1000,"The saved-food library limit is 1,000 records. Edit an existing food or log directly.",409);
                await Upsert<Food>(op, revision, f =>
                {
                    Validation.Nutrients(f); Validation.Number(f.ServingGrams, .1, 100000, "Serving weight");
                    Validation.Require(f.IngredientsJson.Length <= 12000, "Recipe is too large.");
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
        db.Receipts.Add(new MutationReceipt { Id = op.Id, UserId = uid, Hash = hash, Revision = revision });
        await db.SaveChangesAsync(ct); await gate.Commit(ct); return revision;
    }

    private async Task Upsert<T>(Mutation op, long revision, Action<T> validate, CancellationToken ct) where T : OwnedRecord, new()
    {
        var existing = await db.Set<T>().SingleOrDefaultAsync(x => x.Id == op.RecordId, ct);
        Validation.Require((existing?.Revision ?? 0) == op.ExpectedRevision, "This record changed on another device. Review the conflict.", 409);
        Validation.Require(!op.Delete || existing != null, "Record no longer exists.", 409);
        if (op.Delete) { existing!.Deleted = true; existing.Revision = revision; return; }
        var next = op.Data.Deserialize<T>(Json.Options) ?? throw new DomainException("Record is required.");
        validate(next); next.Id = op.RecordId; next.UserId = db.CurrentUser!.Value; next.Revision = revision; next.Deleted = false;
        if (existing == null) db.Set<T>().Add(next);
        else db.Entry(existing).CurrentValues.SetValues(next);
    }
    private static void Date(DateOnly date) => Validation.Require(date >= new DateOnly(2000,1,1) && date <= DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1), "Choose a date from 2000 through today.");
}
