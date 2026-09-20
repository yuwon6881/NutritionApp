using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class GoogleHealthBodyFatSyncTests
{
    [Fact]
    public async Task CreateUsesGoogleHealthBodyFatDataPointShape()
    {
        var handler = new CaptureHandler();
        using var http = new HttpClient(handler);

        var dataPoint = new GoogleHealthBodyFatDataPoint(15.4, "2026-09-18T12:00:00+08:00");

        await GoogleHealthBodyFatProvider.CreateAsync(
            http,
            "access-token",
            dataPoint,
            default);

        using var body = JsonDocument.Parse(handler.Body!);
        var bodyFat = body.RootElement.GetProperty("bodyFat");
        Assert.Equal(15.4, bodyFat.GetProperty("percentage").GetDouble());
        Assert.Equal("2026-09-18T12:00:00+08:00", bodyFat.GetProperty("sampleTime").GetProperty("physicalTime").GetString());
        Assert.Equal("28800s", bodyFat.GetProperty("sampleTime").GetProperty("utcOffset").GetString());
    }

    [Fact]
    public void BuildDataPointProducesValidTimestampAndPercentage()
    {
        var dp = GoogleHealthBodyFatSyncService.BuildDataPoint(
            new DateOnly(2026, 9, 18),
            18.5,
            "Asia/Kuala_Lumpur");

        Assert.Equal(18.5, dp.Percentage);
        Assert.Equal("2026-09-18T12:00:00+08:00", dp.SampleTime);
    }

    [Fact]
    public async Task BodyFatMutationQueuesOnlyWhenTheConnectionIsEnabled()
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
            GrantedScopesJson = JsonSerializer.Serialize(new[] { GoogleHealthBodyFatSyncService.BodyFatScope }),
            BodyFatSyncEnabled = true,
            Status = "connected"
        });
        await db.SaveChangesAsync();

        var google = new GoogleHealthService(new HttpClient(), db, new TestKms(), new ConfigurationBuilder().Build());
        var bodyFatSync = new GoogleHealthBodyFatSyncService(db, google, new HttpClient());
        var recordId = Guid.NewGuid();

        var mutation = new BodyMutation(
            recordId,
            0,
            new BodyPatch(
                Date: new DateOnly(2026, 9, 18),
                Measurements: new Dictionary<string, double?>
                {
                    ["bodyFatPercent"] = 14.8
                }));

        await bodyFatSync.QueueMutationAsync(null, mutation, 1, default);
        await db.SaveChangesAsync();

        var work = await db.GoogleHealthBodyFatSyncWork.SingleAsync(x => x.BodyRecordId == recordId);
        Assert.Equal("pending", work.ProcessingState);
        Assert.Equal(14.8, work.DesiredBodyFatPercent);
        Assert.Equal(new DateOnly(2026, 9, 18), work.DesiredDate);
    }

    private sealed class CaptureHandler : HttpMessageHandler
    {
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"name\":\"operations/test\",\"done\":false}")
            };
        }
    }

    private sealed class TestKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string plaintext, CancellationToken ct) => Task.FromResult(plaintext);
        public Task<string> DecryptAsync(string ciphertext, CancellationToken ct) => Task.FromResult(ciphertext);
    }
}
