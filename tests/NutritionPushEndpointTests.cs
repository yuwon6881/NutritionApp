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

    [Fact]
    public async Task Revoke_capability_removes_exact_subscription_without_session()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"nutrition-push-revoke-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new TestFactory(dbPath);
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();
            var user = await TestUsers.CreateAsync(db, "push-revoke-user");
            db.CurrentUser = user.Id;
            db.NutritionPushSubscriptions.Add(new NutritionPushSubscription
            {
                UserId = user.Id,
                DeviceId = "device-signed-out",
                FcmToken = "token-to-revoke",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();

            // Client with NO session cookie
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            client.DefaultRequestHeaders.Add("X-Nutrition-Request", "1");
            client.DefaultRequestHeaders.Add("Origin", "https://nutrition.example.com");

            var payload = new
            {
                userId = user.Id,
                deviceId = "device-signed-out",
                fcmToken = "token-to-revoke"
            };

            using var response = await client.PostAsJsonAsync("/api/notifications/subscriptions/revoke", payload);
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

            db.ChangeTracker.Clear();
            Assert.Empty(await db.NutritionPushSubscriptions.ToListAsync());
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (File.Exists(dbPath)) File.Delete(dbPath);
        }
    }

    [Fact]
    public async Task Revoke_capability_is_idempotent_and_ignores_mismatches()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"nutrition-push-revoke-mismatch-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new TestFactory(dbPath);
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();
            var user = await TestUsers.CreateAsync(db, "push-revoke-mismatch");
            db.CurrentUser = user.Id;
            db.NutritionPushSubscriptions.Add(new NutritionPushSubscription
            {
                UserId = user.Id,
                DeviceId = "device-preserved",
                FcmToken = "active-fcm-token",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
            await db.SaveChangesAsync();

            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            client.DefaultRequestHeaders.Add("X-Nutrition-Request", "1");
            client.DefaultRequestHeaders.Add("Origin", "https://nutrition.example.com");

            // Mismatched token must return 204 and NOT delete the active token
            var wrongTokenPayload = new
            {
                userId = user.Id,
                deviceId = "device-preserved",
                fcmToken = "mismatched-token"
            };
            using var wrongTokenResp = await client.PostAsJsonAsync("/api/notifications/subscriptions/revoke", wrongTokenPayload);
            Assert.Equal(HttpStatusCode.NoContent, wrongTokenResp.StatusCode);

            // Mismatched userId must return 204 and NOT delete
            var wrongUserPayload = new
            {
                userId = Guid.NewGuid(),
                deviceId = "device-preserved",
                fcmToken = "active-fcm-token"
            };
            using var wrongUserResp = await client.PostAsJsonAsync("/api/notifications/subscriptions/revoke", wrongUserPayload);
            Assert.Equal(HttpStatusCode.NoContent, wrongUserResp.StatusCode);

            db.ChangeTracker.Clear();
            var remaining = await db.NutritionPushSubscriptions.SingleAsync();
            Assert.Equal("active-fcm-token", remaining.FcmToken);
            Assert.Equal("device-preserved", remaining.DeviceId);
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (File.Exists(dbPath)) File.Delete(dbPath);
        }
    }

    [Fact]
    public async Task Revoke_capability_enforces_origin_and_nutrition_header()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"nutrition-push-revoke-sec-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new TestFactory(dbPath);
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

            var payload = new
            {
                userId = Guid.NewGuid(),
                deviceId = "device-1",
                fcmToken = "token-1"
            };

            // Missing origin and X-Nutrition-Request
            using var noHeaders = await client.PostAsJsonAsync("/api/notifications/subscriptions/revoke", payload);
            Assert.Equal(HttpStatusCode.Forbidden, noHeaders.StatusCode);

            // Wrong origin
            using var wrongOriginReq = new HttpRequestMessage(HttpMethod.Post, "/api/notifications/subscriptions/revoke")
            {
                Content = JsonContent.Create(payload)
            };
            wrongOriginReq.Headers.Add("Origin", "https://evil.com");
            wrongOriginReq.Headers.Add("X-Nutrition-Request", "1");
            using var wrongOriginResp = await client.SendAsync(wrongOriginReq);
            Assert.Equal(HttpStatusCode.Forbidden, wrongOriginResp.StatusCode);
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (File.Exists(dbPath)) File.Delete(dbPath);
        }
    }
}
