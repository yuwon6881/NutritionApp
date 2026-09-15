using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class BodyRecordTests
{
    private static async Task<(AppDb Db,BodyRecordService Service,AppUser User)> CreateAsync()
    {
        var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>()).Build();
        var user=await TestUsers.CreateAsync(db, "body-user");
        db.CurrentUser=user.Id;
        var store=new GcsPhotoStore(new HttpClient(new Handler()),config,_=>Task.FromResult("token"));
        return (db,new BodyRecordService(db,store,config),user);
    }

    [Fact]
    public async Task Body_record_replay_is_idempotent_and_measurements_can_be_cleared()
    {
        var (db,service,_)=await CreateAsync();
        await using(db)
        {
            var id=Guid.NewGuid();
            var operation=new BodyMutation(id,0,new BodyPatch(new DateOnly(2026,9,12),new Dictionary<string,double?> {{"waistCm",82}}));
            var created=await service.Apply(id,operation,default);
            Assert.Equal(82,created.Measurements.WaistCm);
            var replay=await service.Apply(id,operation,default);
            Assert.Equal(created.Id,replay.Id);
            Assert.Equal(created.Revision,replay.Revision);
            Assert.Equal(created.Measurements.WaistCm,replay.Measurements.WaistCm);

            var cleared=await service.Apply(id,new BodyMutation(Guid.NewGuid(),created.Revision,new BodyPatch(Measurements:new Dictionary<string,double?> {{"waistCm",null}})),default);
            Assert.Null(cleared.Measurements.WaistCm);
            await Assert.ThrowsAsync<DomainException>(()=>service.Apply(id,new BodyMutation(Guid.NewGuid(),cleared.Revision,new BodyPatch(WeightContext:new BodyWeightContext())),default));
        }
    }

    [Fact]
    public async Task Existing_photo_sets_are_backfilled_as_body_records_without_a_snapshot()
    {
        var (db,service,user)=await CreateAsync();
        await using(db)
        {
            var setId=Guid.NewGuid();
            db.Photos.Add(new PhysiquePhoto {Id=Guid.NewGuid(),UserId=user.Id,SetId=setId,Date=new DateOnly(2026,9,10),Angle="front",Status="complete",Bytes=4});
            await db.SaveChangesAsync();
            var page=await service.Page(null,false,default);
            var record=Assert.Single(page.Records);
            Assert.Equal(setId,record.Id);
            Assert.Equal("legacy-unavailable",record.WeightContext.Provenance);
            Assert.Single(record.Photos);
        }
    }

    private sealed class Handler:HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken)
            =>Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK));
    }
}
