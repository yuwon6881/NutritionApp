using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class GoogleHealthLaunchEndpointTests
{
    [Theory]
    [InlineData(true, 4321, 0)]
    [InlineData(false, 9876, 2)]
    public async Task Cache_reads_are_fast_and_older_clients_still_refresh_steps(bool cacheOnly, long expected, int calls)
    {
        var path = Path.Combine(Path.GetTempPath(), $"nutrition-launch-{Guid.NewGuid():N}.db");
        var provider = new Provider();
        try
        {
            using var factory = new Factory(path, provider);
            var today = RetentionService.Today(Json.Write(new Profile {TimeZone = "Asia/Kuala_Lumpur"}));
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                await db.Database.EnsureCreatedAsync();
                var user = await TestUsers.CreateAsync(db);
                db.CurrentUser = user.Id;
                user.ProfileJson = Json.Write(new Profile {TimeZone = "Asia/Kuala_Lumpur"});
                db.Sessions.Add(new Session {UserId = user.Id, Hash = AuthService.Hash("launch-token"), Expires = DateTime.UtcNow.AddDays(1)});
                db.GoogleHealthConnections.Add(new GoogleHealthConnection {
                    UserId = user.Id, Status = "connected", LastSyncedAt = DateTime.UtcNow.AddHours(-1),
                    EncryptedRefreshToken = "refresh", EncryptedStepHistoryJson = JsonSerializer.Serialize(new[] {new GoogleHealthDay(today, 4321)})
                });
                await db.SaveChangesAsync();
            }
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("Cookie", $"{AuthService.Cookie}=launch-token");
            client.DefaultRequestHeaders.Add("Origin", "https://localhost");
            client.DefaultRequestHeaders.Add("X-Nutrition-Request", "1");
            // The legacy request deliberately omits the new cacheOnly option.
            using var response = cacheOnly
                ? await client.PostAsJsonAsync("/api/integrations/google-health/sync", new {force = false, cacheOnly = true})
                : await client.PostAsJsonAsync("/api/integrations/google-health/sync", new {force = false});
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var result = await response.Content.ReadFromJsonAsync<GoogleHealthSyncResult>();
            Assert.Contains(result!.Days, day => day.Date == today && day.Count == expected);
            Assert.Equal(calls, provider.Calls);
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            try {File.Delete(path);} catch { }
        }
    }
    private sealed class Factory(string path, Provider provider) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                ["Database:SqlitePath"] = path, ["PublicOrigin"] = "https://localhost",
                ["GoogleHealth:ClientId"] = "client", ["GoogleHealth:ClientSecret"] = "secret"
            }));
            builder.ConfigureTestServices(services => {
                services.AddSingleton<IGoogleHealthKms, PlainKms>();
                services.AddScoped(p => new GoogleHealthService(new HttpClient(provider, false), p.GetRequiredService<AppDb>(),
                    p.GetRequiredService<IGoogleHealthKms>(), p.GetRequiredService<IConfiguration>()));
            });
        }
    }
    private sealed class PlainKms : IGoogleHealthKms
    {
        public Task<string> EncryptAsync(string value, CancellationToken ct) => Task.FromResult(value);
        public Task<string> DecryptAsync(string value, CancellationToken ct) => Task.FromResult(value);
    }
    private sealed class Provider : HttpMessageHandler
    {
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            var date = RetentionService.Today(Json.Write(new Profile {TimeZone = "Asia/Kuala_Lumpur"}));
            var body = request.RequestUri!.Host == "oauth2.googleapis.com" ? "{\"access_token\":\"token\"}"
                : JsonSerializer.Serialize(new {rollupDataPoints = new[] {new {
                    civilStartTime = new {date = new {year = date.Year, month = date.Month, day = date.Day}}, steps = new {countSum = "9876"}
                }}});
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) {Content = new StringContent(body)});
        }
    }
}
