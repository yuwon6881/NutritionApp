using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class NutritionPushEndpointTests
{
    private sealed class TestFactory(string dbPath) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:SqlitePath"] = dbPath,
                ["PublicOrigin"] = "https://nutrition.example.com"
            }));
        }
    }

    [Fact]
    public async Task Delete_subscription_accepts_the_exact_token_and_preserves_refreshed_tokens()
    {
        var dbPath=Path.Combine(Path.GetTempPath(),$"nutrition-push-endpoint-{Guid.NewGuid():N}.db");
        try
        {
            using var factory=new TestFactory(dbPath);
            using var scope=factory.Services.CreateScope();
            var db=scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();
            var user=await TestUsers.CreateAsync(db,"push-endpoint");
            db.CurrentUser=user.Id;
            db.NutritionPushSubscriptions.Add(new NutritionPushSubscription
            {
                UserId=user.Id,
                DeviceId="device-a",
                FcmToken="current-token",
                CreatedAt=DateTime.UtcNow,
                UpdatedAt=DateTime.UtcNow
            });
            var session=Guid.NewGuid().ToString("N");
            db.Sessions.Add(new Session
            {
                UserId=user.Id,
                Hash=AuthService.Hash(session),
                Expires=DateTime.UtcNow.AddDays(1)
            });
            await db.SaveChangesAsync();

            using var client=factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false});
            client.DefaultRequestHeaders.Add("X-Nutrition-Request","1");
            client.DefaultRequestHeaders.Add("Origin","https://nutrition.example.com");
            client.DefaultRequestHeaders.Add("Cookie",$"{AuthService.Cookie}={session}");

            using var staleRequest=new HttpRequestMessage(HttpMethod.Delete,"/api/notifications/subscriptions/device-a")
            {
                Content=JsonContent.Create(new {fcmToken="stale-token"})
            };
            Assert.Equal(HttpStatusCode.NoContent,(await client.SendAsync(staleRequest)).StatusCode);
            db.ChangeTracker.Clear();
            Assert.Equal("current-token",await db.NutritionPushSubscriptions.Select(item=>item.FcmToken).SingleAsync());

            using var currentRequest=new HttpRequestMessage(HttpMethod.Delete,"/api/notifications/subscriptions/device-a")
            {
                Content=JsonContent.Create(new {fcmToken="current-token"})
            };
            Assert.Equal(HttpStatusCode.NoContent,(await client.SendAsync(currentRequest)).StatusCode);
            db.ChangeTracker.Clear();
            Assert.Empty(await db.NutritionPushSubscriptions.ToListAsync());
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if(File.Exists(dbPath))File.Delete(dbPath);
        }
    }
}
