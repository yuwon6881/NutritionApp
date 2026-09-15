using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class FoodBarcodeTests : IAsyncLifetime
{
    private readonly string path=Path.Combine(Path.GetTempPath(),$"nutrition-barcode-{Guid.NewGuid()}.db");
    private AppDb Open(Guid? user=null)=>new(new DbContextOptionsBuilder<AppDb>().UseSqlite($"Data Source={path}").Options){CurrentUser=user};

    public async Task InitializeAsync(){await using var db=Open();await db.Database.EnsureCreatedAsync();}
    public Task DisposeAsync(){Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();File.Delete(path);return Task.CompletedTask;}

    private sealed class FailHandler:HttpMessageHandler
    {
        public int Calls{get;private set;}
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound){Content=new StringContent("{}")});
        }
    }

    [Fact]
    public async Task Account_food_barcode_is_resolved_before_open_food_facts()
    {
        var user=Guid.NewGuid();
        await using(var seed=Open())
        {
            seed.Users.Add(new AppUser{Id=user,DisplayName="barcode-local",IdentitySubject="sub_local"});
            await seed.SaveChangesAsync();
        }
        await using(var seed=Open(user))
        {
            seed.Foods.Add(new Food{Id=Guid.NewGuid(),UserId=user,Name="Private tuna",Calories=180,Protein=25,Barcode="9551234567890",PortionsJson="[{\"label\":\"can\",\"grams\":185}]"});
            await seed.SaveChangesAsync();
        }

        var handler=new FailHandler();
        var service=new FoodSearchService(new HttpClient(handler),new MemoryCache(new MemoryCacheOptions{SizeLimit=256}));
        await using var db=Open(user);
        var result=await service.Barcode("9551234567890",db,default);

        Assert.Equal("Private tuna",result.Name);
        Assert.Equal("9551234567890",result.Code);
        Assert.Equal(185,Assert.Single(result.Portions!).Grams);
        Assert.Equal(0,handler.Calls);
    }

    [Fact]
    public async Task Food_barcode_updates_preserve_omitted_legacy_fields_and_reject_duplicates()
    {
        var user=Guid.NewGuid();
        await using(var seed=Open())
        {
            seed.Users.Add(new AppUser{Id=user,DisplayName="barcode-sync",IdentitySubject="sub_sync"});
            await seed.SaveChangesAsync();
        }
        async Task<long> Apply(Guid id,long revision,object data)
        {
            await using var db=Open(user);
            return await new SyncService(db).Apply(new Mutation(Guid.NewGuid(),"food",id,revision,JsonSerializer.SerializeToElement(data)),default);
        }

        var first=Guid.NewGuid();
        var revision=await Apply(first,0,new{name="Tuna",calories=180,servingGrams=100,barcode="9551234567890"});
        revision=await Apply(first,revision,new{name="Tuna updated",calories=190,servingGrams=100});
        await using(var verify=Open(user))Assert.Equal("9551234567890",(await verify.Foods.SingleAsync()).Barcode);

        var duplicate=await Assert.ThrowsAsync<DomainException>(()=>Apply(Guid.NewGuid(),0,new{name="Other",calories=100,servingGrams=100,barcode="9551234567890"}));
        Assert.Equal(409,duplicate.Status);
        var invalid=await Assert.ThrowsAsync<DomainException>(()=>Apply(Guid.NewGuid(),0,new{name="Invalid",calories=100,servingGrams=100,barcode="1234"}));
        Assert.Equal(400,invalid.Status);
    }
}
