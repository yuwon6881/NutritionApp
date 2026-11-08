using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class BodyPhotoHardeningTests
{
    private sealed class Handler:HttpMessageHandler
    {
        public int Reads;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {
            var metadata=request.RequestUri!.Query.Contains("fields=generation");
            if(request.Method==HttpMethod.Get&&!metadata)Reads++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=metadata?new StringContent("{\"generation\":\"7\"}"):new ByteArrayContent([255,216,1,2,255,217])});
        }
    }

    private static async Task<(AppDb Db,PhotoService Photos,BodyRecordService Body,AppUser User,Handler Handler)> CreateAsync()
    {
        var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Physique:Bucket"]="test"}).Build();
        var user=await TestUsers.CreateAsync(db,"hardening");
        db.CurrentUser=user.Id;
        var handler=new Handler();var http=new HttpClient(handler);
        var store=new GcsPhotoStore(http,config,_=>Task.FromResult("token"));
        var cache=new MemoryCache(new MemoryCacheOptions());
        return (db,new PhotoService(db,store,config,new StorageService(db,cache,new TemporaryImageStore(http,config))),new BodyRecordService(db,store,config),user,handler);
    }

    private static PhotoSetInput Photo(DateOnly date)=>new(Guid.NewGuid(),date,[new PhotoPart(Guid.NewGuid(),"front",Convert.ToBase64String([255,216,1,2,255,217]))]);

    private static BodyMutation Save(long revision,BodyPatch patch)=>new(Guid.NewGuid(),revision,patch);

    [Fact]
    public void Default_photo_budget_is_two_gibibytes_per_account()
    {
        var empty=new ConfigurationBuilder().Build();
        Assert.Equal(2L*1024*1024*1024,PhotoService.MaxBytes(empty));
        var configured=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Physique:MaxBytesPerUser"]="1000"}).Build();
        Assert.Equal(1000,PhotoService.MaxBytes(configured));
    }

    [Fact]
    public async Task Photo_dates_follow_the_profile_today_like_record_edits()
    {
        var (db,photos,_,_,_)=await CreateAsync();
        await using(db)
        {
            var today=RetentionService.Today(null);
            await Assert.ThrowsAsync<DomainException>(()=>photos.Upload(Photo(today.AddDays(1)),default));
            Assert.Single(await photos.Upload(Photo(today),default));
        }
    }

    [Fact]
    public async Task Conditional_photo_requests_read_the_generation_without_fetching_the_object()
    {
        var (db,photos,_,_,handler)=await CreateAsync();
        await using(db)
        {
            var uploaded=(await photos.Upload(Photo(new DateOnly(2026,1,1)),default)).Single();
            Assert.Equal("7",await photos.Generation(uploaded.Id,default));
            Assert.Equal(0,handler.Reads);
            await photos.ContentWithMetadata(uploaded.Id,default);
            Assert.Equal(1,handler.Reads);
        }
    }

    [Fact]
    public async Task Abandoned_photo_intents_are_cleared_after_a_week_and_recent_ones_stay()
    {
        var (db,photos,_,user,_)=await CreateAsync();
        await using(db)
        {
            var intent=Json.Write(new List<BodyPhotoIntent>{new(Guid.NewGuid(),"front")});
            BodyRecord Record(int order,int ageDays)=>new(){Id=Guid.NewGuid(),UserId=user.Id,Date=new DateOnly(2026,1,1),CreationOrder=order,
                Created=DateTime.UtcNow.AddDays(-ageDays),Updated=DateTime.UtcNow.AddDays(-ageDays),PendingPhotosJson=intent,
                WeightContextJson=Json.Write(new BodyWeightContext())};
            var stale=Record(1,8);var fresh=Record(2,1);
            db.BodyRecords.AddRange(stale,fresh);await db.SaveChangesAsync();
            await photos.Cleanup(default);
            db.ChangeTracker.Clear();
            Assert.Equal("[]",(await db.BodyRecords.IgnoreQueryFilters().SingleAsync(b=>b.Id==stale.Id)).PendingPhotosJson);
            Assert.Equal(intent,(await db.BodyRecords.IgnoreQueryFilters().SingleAsync(b=>b.Id==fresh.Id)).PendingPhotosJson);
        }
    }

    [Fact]
    public async Task Implausible_measurements_are_rejected()
    {
        var (db,_,body,_,_)=await CreateAsync();
        await using(db)
        {
            var id=Guid.NewGuid();
            var date=new DateOnly(2026,1,1);
            await Assert.ThrowsAsync<DomainException>(()=>body.Apply(id,Save(0,new BodyPatch(date,new Dictionary<string,double?>{{"waistCm",800}})),default));
            var saved=await body.Apply(id,Save(0,new BodyPatch(date,new Dictionary<string,double?>{{"waistCm",BodyRecordService.MaxCircumferenceCm}})),default);
            Assert.Equal(BodyRecordService.MaxCircumferenceCm,saved.Measurements.WaistCm);
        }
    }

    [Fact]
    public async Task An_edit_cannot_leave_a_record_with_no_measurement_and_no_photo()
    {
        var (db,_,body,_,_)=await CreateAsync();
        await using(db)
        {
            var id=Guid.NewGuid();
            var created=await body.Apply(id,Save(0,new BodyPatch(new DateOnly(2026,1,1),new Dictionary<string,double?>{{"waistCm",80},{"neckCm",38}})),default);
            var oneLeft=await body.Apply(id,Save(created.Revision,new BodyPatch(Measurements:new Dictionary<string,double?>{{"waistCm",null}})),default);
            await Assert.ThrowsAsync<DomainException>(()=>body.Apply(id,Save(oneLeft.Revision,new BodyPatch(Measurements:new Dictionary<string,double?>{{"neckCm",null}})),default));
        }
    }

    [Fact]
    public async Task Compare_can_page_further_back_with_a_larger_limit()
    {
        var (db,_,body,user,_)=await CreateAsync();
        await using(db)
        {
            for(var i=1;i<=45;i++)db.BodyRecords.Add(new BodyRecord{Id=Guid.NewGuid(),UserId=user.Id,Date=new DateOnly(2026,1,1).AddDays(i),CreationOrder=i,
                Created=DateTime.UtcNow,Updated=DateTime.UtcNow,WeightContextJson=Json.Write(new BodyWeightContext())});
            await db.SaveChangesAsync();
            var all=await body.Page(null,false,default,100);
            Assert.Equal(45,all.Records.Count);Assert.False(all.HasMore);
            var small=await body.Page(null,false,default,20);
            Assert.Equal(20,small.Records.Count);Assert.True(small.HasMore);
        }
    }
}
