using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

/// Pins the outbound sync status contract while it is computed in SQL rather than over the whole work table.
public sealed class GoogleHealthSyncStatusTests
{
    private static readonly DateTime Base = new(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Status_counts_in_flight_rows_and_reports_the_newest_problem_for_the_current_user_only()
    {
        await using var db = await CreateDb();
        var user = db.CurrentUser!.Value;
        var other = Guid.NewGuid();
        db.Users.Add(new AppUser { Id = other, DisplayName = "other", IdentitySubject = "other-subject" });
        await db.SaveChangesAsync();
        db.CurrentUser = other;
        AddNutritionWork(db, other, ("failed", 99), ("pending", 1));
        await db.SaveChangesAsync();
        db.CurrentUser = user;
        AddNutritionWork(db, user, ("pending", 1), ("processing", 2), ("awaiting_operation", 3), ("succeeded", 9),
            ("cancelled", 8), ("failed", 4), ("unknown", 5));
        db.GoogleHealthWeightSyncWork.AddRange(
            new GoogleHealthWeightSyncWork { Id = Guid.NewGuid(), UserId = user, WeightId = Guid.NewGuid(), ProcessingState = "succeeded" },
            new GoogleHealthWeightSyncWork { Id = Guid.NewGuid(), UserId = user, WeightId = Guid.NewGuid(), ProcessingState = "pending" });
        await db.SaveChangesAsync();
        var google = new GoogleHealthService(new HttpClient(), db, new TestKms(), new ConfigurationBuilder().Build());

        var nutrition = await new GoogleHealthNutritionSyncService(db, google, new HttpClient()).GetStatusAsync(default);
        var weight = await new GoogleHealthWeightSyncService(db, google, new HttpClient()).GetStatusAsync(default);
        var bodyFat = await new GoogleHealthBodyFatSyncService(db, google, new HttpClient()).GetStatusAsync(default);

        Assert.Equal(("unknown", 3, "unknown-5", "message unknown"), (nutrition.State, nutrition.PendingCount, nutrition.FailureCode, nutrition.FailureMessage));
        Assert.Equal(("pending", 1, null as string), (weight.State, weight.PendingCount, weight.FailureCode));
        Assert.Equal(("disabled", 0), (bodyFat.State, bodyFat.PendingCount));

        var attached = await google.AttachSyncStatusesAsync(user, new GoogleHealthSyncResult("connected", null, null, "fresh", []), default);
        Assert.Equal(nutrition, attached.NutritionSync);
        Assert.Equal(weight, attached.WeightSync);
        Assert.Equal(bodyFat, attached.BodyFatSync);
    }

    [Fact]
    public async Task Body_fat_status_flags_work_whose_body_record_is_missing()
    {
        await using var db = await CreateDb();
        var user = db.CurrentUser!.Value;
        (await db.GoogleHealthConnections.SingleAsync()).BodyFatSyncEnabled = true;
        var record = new BodyRecord { Id = Guid.NewGuid(), UserId = user, Date = new DateOnly(2026, 9, 1) };
        db.BodyRecords.Add(record);
        db.GoogleHealthBodyFatSyncWork.Add(new GoogleHealthBodyFatSyncWork { Id = Guid.NewGuid(), UserId = user, BodyRecordId = record.Id, ProcessingState = "pending" });
        await db.SaveChangesAsync();
        var google = new GoogleHealthService(new HttpClient(), db, new TestKms(), new ConfigurationBuilder().Build());
        var sync = new GoogleHealthBodyFatSyncService(db, google, new HttpClient());

        var mapped = await sync.GetStatusAsync(default);
        Assert.Equal(("pending", 1, null as string), (mapped.State, mapped.PendingCount, mapped.FailureCode));

        db.GoogleHealthBodyFatSyncWork.Add(new GoogleHealthBodyFatSyncWork { Id = Guid.NewGuid(), UserId = user, BodyRecordId = Guid.NewGuid(), ProcessingState = "succeeded" });
        await db.SaveChangesAsync();
        var legacy = await sync.GetStatusAsync(default);
        Assert.Equal(("failed", 0, "legacy_mapping"), (legacy.State, legacy.PendingCount, legacy.FailureCode));
    }

    private static void AddNutritionWork(AppDb db, Guid owner, params (string State, int Minutes)[] rows)
    {
        foreach (var (state, minutes) in rows)
            db.GoogleHealthNutritionSyncWork.Add(new GoogleHealthNutritionSyncWork
            {
                Id = Guid.NewGuid(), UserId = owner, EntryId = Guid.NewGuid(), ProcessingState = state,
                UpdatedAt = Base.AddMinutes(minutes), LastErrorCategory = $"{state}-{minutes}", LastErrorMessage = $"message {state}"
            });
    }

    private static async Task<AppDb> CreateDb()
    {
        var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options) { CurrentUser = Guid.NewGuid() };
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        db.Users.Add(new AppUser { Id = db.CurrentUser.Value, DisplayName = "status-user", IdentitySubject = "status-subject" });
        db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = db.CurrentUser.Value,
            GoogleIdHash = "status-google",
            EncryptedRefreshToken = "refresh",
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthNutritionSyncService.NutritionScope, GoogleHealthBodyFatSyncService.BodyFatScope }),
            NutritionSyncEnabled = true,
            WeightSyncEnabled = true,
            BodyFatSyncEnabled = false,
            Status = "connected"
        });
        await db.SaveChangesAsync();
        return db;
    }

    private sealed class TestKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext);
    }
}
