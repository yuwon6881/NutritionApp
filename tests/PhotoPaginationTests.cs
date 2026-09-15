using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class PhotoPaginationTests
{
    private sealed class Handler:HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
            =>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=request.Method==HttpMethod.Get?new ByteArrayContent([255,216,1,2,255,217]):new StringContent("{\"generation\":\"1\"}")});
    }

    [Fact]
    public async Task Page_returns_complete_sets_and_a_stable_tied_date_cursor()
    {
        await using var connection=new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var db=new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>
        { ["Physique:Bucket"]="test", ["Physique:MaxBytesPerUser"]="1000" }).Build();
        var user=await TestUsers.CreateAsync(db, "photo-page-user");
        db.CurrentUser=user.Id;
        using var cache=new MemoryCache(new MemoryCacheOptions());
        using var http=new HttpClient(new Handler());
        var service=new PhotoService(db,new GcsPhotoStore(http,config,_=>Task.FromResult("token")),config,new StorageService(db,cache,new TemporaryImageStore(http,config)));
        var date=RetentionService.Today(user.ProfileJson);
        for(var i=0;i<3;i++)
        {
            var input=new PhotoSetInput(Guid.NewGuid(),date,[new PhotoPart(Guid.NewGuid(),"front",Convert.ToBase64String([255,216,1,2,255,217]))]);
            await service.Upload(input,default);
        }

        var first=await service.Page(null,2,default);
        Assert.Equal(2,first.Sets.Count);
        Assert.True(first.HasMore);
        Assert.NotNull(first.NextCursor);
        var second=await service.Page(first.NextCursor,2,default);
        Assert.Single(second.Sets);
        Assert.False(second.HasMore);
        Assert.DoesNotContain(second.Sets[0].Id,first.Sets.Select(set=>set.Id));
    }
}
