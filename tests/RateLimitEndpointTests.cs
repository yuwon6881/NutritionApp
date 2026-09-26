using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class RateLimitEndpointTests
{
    [Fact]
    public async Task Account_budget_is_shared_by_sessions_and_separate_from_other_accounts()
    {
        var path = Path.Combine(Path.GetTempPath(), $"nutrition-rate-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new RateFactory(path);
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();
            var first = await TestUsers.CreateAsync(db, "rate-first");
            var second = await TestUsers.CreateAsync(db, "rate-second");
            var sessions = new[] { (first.Id,"session-a"), (first.Id,"session-b"), (second.Id,"session-c") };
            foreach (var (owner, token) in sessions)
                db.Sessions.Add(new Session {UserId=owner, Hash=AuthService.Hash(token), Expires=DateTime.UtcNow.AddDays(1)});
            await db.SaveChangesAsync();
            using var client = factory.CreateClient();
            async Task<HttpResponseMessage> Progress(string token)
            {
                using var request = new HttpRequestMessage(HttpMethod.Get,"/api/progress/summary?period=week");
                request.Headers.Add("Cookie",$"{AuthService.Cookie}={token}");
                return await client.SendAsync(request);
            }
            using var allowed = await Progress("session-a");
            Assert.Equal(HttpStatusCode.OK,allowed.StatusCode);
            using var blocked = await Progress("session-b");
            Assert.Equal(HttpStatusCode.TooManyRequests,blocked.StatusCode);
            Assert.True(blocked.Headers.RetryAfter?.Delta > TimeSpan.Zero);
            Assert.Contains("wait",await blocked.Content.ReadAsStringAsync());
            using var independent = await Progress("session-c");
            Assert.Equal(HttpStatusCode.OK,independent.StatusCode);
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); if(File.Exists(path))File.Delete(path); }
    }

    [Fact]
    public async Task Signed_out_capability_requests_are_rate_limited()
    {
        var path = Path.Combine(Path.GetTempPath(), $"nutrition-revoke-rate-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new RateFactory(path);
            using var scope = factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<AppDb>().Database.EnsureCreatedAsync();
            using var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("Origin","https://nutrition.test");
            client.DefaultRequestHeaders.Add("X-Nutrition-Request","1");
            var payload = new {userId=Guid.NewGuid(),deviceId="device",fcmToken="token"};
            using var first = await client.PostAsJsonAsync("/api/notifications/subscriptions/revoke",payload);
            Assert.Equal(HttpStatusCode.NoContent,first.StatusCode);
            using var second = await client.PostAsJsonAsync("/api/notifications/subscriptions/revoke",payload);
            Assert.Equal(HttpStatusCode.TooManyRequests,second.StatusCode);
            Assert.True(second.Headers.RetryAfter?.Delta > TimeSpan.Zero);
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); if(File.Exists(path))File.Delete(path); }
    }

    private sealed class RateFactory(string path) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_,config)=>config.AddInMemoryCollection(new Dictionary<string,string?>
            {
                ["Database:SqlitePath"]=path,["PublicOrigin"]="https://nutrition.test",
                ["RateLimits:Progress:PermitLimit"]="1",["RateLimits:DeviceRevocation:PermitLimit"]="1"
            }));
        }
    }
}
