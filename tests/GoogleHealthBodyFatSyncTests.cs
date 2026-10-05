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
            Guid.NewGuid(),
            0,
            new BodyPatch(
                Date: new DateOnly(2026, 9, 18),
                Measurements: new Dictionary<string, double?>
                {
                    ["bodyFatPercent"] = 14.8
                }));

        var record=new BodyRecord{Id=recordId,UserId=db.CurrentUser.Value,Date=new DateOnly(2026,9,18),CreationOrder=1};
        record.Measurements.BodyFatPercent=14.8;
        db.BodyRecords.Add(record);await db.SaveChangesAsync();
        await bodyFatSync.QueueMutationAsync(recordId,null,record,mutation,1,default);
        await db.SaveChangesAsync();

        var work = await db.GoogleHealthBodyFatSyncWork.SingleAsync(x => x.BodyRecordId == recordId);
        Assert.Equal("pending", work.ProcessingState);
        Assert.Equal(14.8, work.DesiredBodyFatPercent);
        Assert.Equal(new DateOnly(2026, 9, 18), work.DesiredDate);
        work.GoogleResourceName="users/me/dataSources/app/dataPoints/bodyfat";
        record.Measurements.BodyFatPercent=16.2;
        await bodyFatSync.QueueMutationAsync(recordId,record,record,new BodyMutation(Guid.NewGuid(),1,new BodyPatch(Measurements:new(){{"bodyFatPercent",16.2}})),2,default);
        Assert.Equal(16.2,work.DesiredBodyFatPercent);
        record.Date=record.Date.AddDays(-1);
        await bodyFatSync.QueueMutationAsync(recordId,record,record,new BodyMutation(Guid.NewGuid(),2,new BodyPatch(Date:record.Date)),3,default);
        Assert.False(work.DesiredDeleted);Assert.Equal(16.2,work.DesiredBodyFatPercent);Assert.Equal(record.Date,work.DesiredDate);
        record.Measurements.BodyFatPercent=null;
        await bodyFatSync.QueueMutationAsync(recordId,record,record,new BodyMutation(Guid.NewGuid(),3,new BodyPatch(Measurements:new(){{"bodyFatPercent",null}})),4,default);
        Assert.True(work.DesiredDeleted);
        // Exercise patches through the real Body service, including omitted fields and deletion.
        record.Revision=4;(await db.Users.SingleAsync()).Revision=4;await db.SaveChangesAsync();
        var config=new ConfigurationBuilder().Build();
        var body=new BodyRecordService(db,new GcsPhotoStore(new HttpClient(),config,_=>Task.FromResult("token")),config,bodyFatSync);
        var saved=await body.Apply(recordId,new BodyMutation(Guid.NewGuid(),4,new BodyPatch(Measurements:new(){{"bodyFatPercent",19}})),default);
        Assert.Equal(19,work.DesiredBodyFatPercent);Assert.False(work.DesiredDeleted);
        saved=await body.Apply(recordId,new BodyMutation(Guid.NewGuid(),saved.Revision,new BodyPatch(Date:record.Date.AddDays(-1))),default);
        Assert.Equal(19,saved.Measurements.BodyFatPercent);Assert.Equal(19,work.DesiredBodyFatPercent);Assert.False(work.DesiredDeleted);
        saved=await body.Apply(recordId,new BodyMutation(Guid.NewGuid(),saved.Revision,new BodyPatch(Measurements:new(){{"bodyFatPercent",null}})),default);
        Assert.True(work.DesiredDeleted);
        await body.Apply(recordId,new BodyMutation(Guid.NewGuid(),saved.Revision,Action:"delete"),default);
        Assert.True(work.DesiredDeleted);
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
