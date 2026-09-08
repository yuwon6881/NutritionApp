using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;
namespace Nutrition.Tests;
public sealed class PhotoPersistenceTests
{
    private sealed class Handler:HttpMessageHandler
    {
        public int Writes;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)
        {
            if(request.Method==HttpMethod.Post)Writes++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=request.RequestUri!.Query.Contains("fields=generation")?new StringContent("{\"generation\":\"1\"}"):new ByteArrayContent([255,216,1,2,255,217])});
        }
    }
    [Fact] public async Task Photo_retry_is_idempotent_quota_is_reserved_and_foreign_reads_fail()
    {
        var path=Path.Combine(Path.GetTempPath(),$"nutrition-photo-{Guid.NewGuid()}.db");
        var options=new DbContextOptionsBuilder<AppDb>().UseSqlite($"Data Source={path}").Options;
        var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{["Physique:Bucket"]="test",["Physique:MaxBytesPerUser"]="6",["Auth:MaxUsers"]="2"}).Build();
        try
        {
            await using var db=new AppDb(options);await db.Database.EnsureCreatedAsync();
            var alice=await new AuthService(db,config).Register("alice","a sufficiently long password",default);
            var bob=await new AuthService(db,config).Register("bob","a sufficiently long password",default);
            db.CurrentUser=alice.Id;var handler=new Handler();var http=new HttpClient(handler);
            using var cache=new MemoryCache(new MemoryCacheOptions());
            var service=new PhotoService(db,new GcsPhotoStore(http,config,_=>Task.FromResult("fake-token")),config,new StorageService(db,cache,new TemporaryImageStore(http,config)));
            var input=new PhotoInput(Guid.NewGuid(),new(2026,1,1),"First","front",Convert.ToBase64String([255,216,1,2,255,217]));
            var photo=await service.Upload(input,default);Assert.Equal("complete",photo.Status);
            Assert.Equal(photo,await service.Upload(input,default));Assert.Equal(1,handler.Writes);
            await Assert.ThrowsAsync<DomainException>(()=>service.Upload(input with {Id=Guid.NewGuid()},default));
            db.CurrentUser=bob.Id;Assert.Empty(await db.Photos.ToListAsync());
            await Assert.ThrowsAsync<DomainException>(()=>service.Content(input.Id,default));
            await Assert.ThrowsAsync<DomainException>(()=>service.Delete(input.Id,default));
            db.CurrentUser=alice.Id;await service.Delete(input.Id,default);
            await Assert.ThrowsAsync<DomainException>(()=>service.Upload(input,default));
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();File.Delete(path); }
    }
}
