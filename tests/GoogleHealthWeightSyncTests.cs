using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class GoogleHealthWeightSyncTests
{
    [Theory]
    [InlineData(72.5, 72500)]
    [InlineData(20, 20000)]
    [InlineData(400, 400000)]
    public void WeightIsConvertedToWholeGrams(double kilograms, long expectedGrams)
    {
        Assert.Equal(expectedGrams, GoogleHealthWeightSyncService.ToGrams(kilograms));
    }

    [Fact]
    public void MeasurementUsesNoonAndPreservesProfileOffset()
    {
        var timestamp = GoogleHealthWeightSyncService.MeasurementTimestamp(
            new DateOnly(2026, 9, 18), "Asia/Kuala_Lumpur");

        Assert.Equal("2026-09-18T12:00:00+08:00", timestamp.ToString("yyyy-MM-dd'T'HH:mm:sszzz"));
    }

    [Fact]
    public void MeasurementUsesUtcWhenProfileZoneIsMissing()
    {
        var timestamp = GoogleHealthWeightSyncService.MeasurementTimestamp(
            new DateOnly(2026, 9, 18), null);

        Assert.Equal(TimeSpan.Zero, timestamp.Offset);
        Assert.Equal(12, timestamp.Hour);
    }

    [Fact]
    public void WeightDataPointContainsOnlyRecordedScaleWeight()
    {
        var payload = GoogleHealthWeightSyncService.BuildDataPoint(
            new DateOnly(2026, 9, 18), 72.5, "Asia/Kuala_Lumpur");

        Assert.Equal(72500, payload.WeightGrams);
        Assert.Equal("2026-09-18T12:00:00+08:00", payload.SampleTime);
        Assert.Null(payload.Notes);
    }

    [Fact]
    public async Task WeightMutationQueuesOnlyWhenTheConnectionIsEnabled()
    {
        await using var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options)
        {
            CurrentUser = Guid.NewGuid()
        };
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        db.Users.Add(new AppUser { Id = db.CurrentUser.Value, DisplayName = "queue-user", IdentitySubject = "queue-subject" });
        db.GoogleHealthConnections.Add(new GoogleHealthConnection
        {
            UserId = db.CurrentUser.Value,
            GoogleIdHash = "queue-google",
            EncryptedRefreshToken = "refresh",
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthWeightSyncService.WeightScope }),
            WeightSyncEnabled = true,
            Status = "connected"
        });
        await db.SaveChangesAsync();

        var google = new GoogleHealthService(new HttpClient(), db, new TestKms(), new ConfigurationBuilder().Build());
        var weightSync = new GoogleHealthWeightSyncService(db, google, new HttpClient());
        var sync = new SyncService(db, weightSync: weightSync);
        var weightId = Guid.NewGuid();
        var mutation = new Mutation(
            Guid.NewGuid(),
            "weight",
            weightId,
            0,
            JsonSerializer.SerializeToElement(new { date = "2026-09-18", kg = 72.5 }));

        await sync.Apply(mutation, default);

        var work = await db.GoogleHealthWeightSyncWork.SingleAsync(x => x.WeightId == weightId);
        Assert.Equal("pending", work.ProcessingState);
        Assert.Equal(72500, GoogleHealthWeightSyncService.ToGrams(work.DesiredKg));
    }

    private sealed class TestKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext);
    }
}