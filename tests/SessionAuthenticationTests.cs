using System.Diagnostics.Metrics;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

[CollectionDefinition("Session authentication", DisableParallelization = true)]
public sealed class SessionAuthenticationCollection { }

[Collection("Session authentication")]
public sealed class SessionAuthenticationTests
{
    private sealed class Factory(string dbPath) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:SqlitePath"] = dbPath,
                ["PublicOrigin"] = "https://localhost"
            }));
        }
    }

    [Fact]
    public async Task Cached_session_avoids_repeat_lookup_and_logout_invalidates_it()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"nutrition-session-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new Factory(dbPath);
            var token = Guid.NewGuid().ToString("N");
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                await db.Database.EnsureCreatedAsync();
                var user = await TestUsers.CreateAsync(db, "session-cache");
                db.CurrentUser = user.Id;
                db.Sessions.Add(new Session { UserId = user.Id, Hash = AuthService.Hash(token), Expires = DateTime.UtcNow.AddDays(1) });
                await db.SaveChangesAsync();
            }

            long commands = 0;
            using var listener = new MeterListener();
            listener.InstrumentPublished = (instrument, meter) =>
            {
                if (instrument.Meter.Name == "Fitness.Nutrition.Database" && instrument.Name == "db.command.count")
                    meter.EnableMeasurementEvents(instrument);
            };
            listener.SetMeasurementEventCallback<long>((_, value, _, _) => Interlocked.Add(ref commands, value));
            listener.Start();

            using var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("Cookie", $"{AuthService.Cookie}={token}");
            client.DefaultRequestHeaders.Add("Origin", "https://localhost");
            client.DefaultRequestHeaders.Add("X-Nutrition-Request", "1");

            var before = Interlocked.Read(ref commands);
            using (var first = await client.GetAsync("/api/auth/me")) Assert.Equal(HttpStatusCode.OK, first.StatusCode);
            var firstCommands = Interlocked.Read(ref commands) - before;

            before = Interlocked.Read(ref commands);
            using (var cached = await client.GetAsync("/api/auth/me")) Assert.Equal(HttpStatusCode.OK, cached.StatusCode);
            var cachedCommands = Interlocked.Read(ref commands) - before;
            Assert.Equal(2, firstCommands);
            Assert.Equal(1, cachedCommands);

            var memoryCache = factory.Services.GetRequiredService<IMemoryCache>();
            before = Interlocked.Read(ref commands);
            using (var bootstrap = await client.GetAsync("/api/bootstrap")) Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
            var cachedBootstrapCommands = Interlocked.Read(ref commands) - before;
            memoryCache.Remove(AuthService.SessionCacheKey(AuthService.Hash(token)));
            before = Interlocked.Read(ref commands);
            using (var uncachedBootstrap = await client.GetAsync("/api/bootstrap")) Assert.Equal(HttpStatusCode.OK, uncachedBootstrap.StatusCode);
            var uncachedBootstrapCommands = Interlocked.Read(ref commands) - before;
            Assert.Equal(cachedBootstrapCommands + 1, uncachedBootstrapCommands);

            using var logout = await client.PostAsync("/api/auth/logout", null);
            Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
            using var rejected = await client.GetAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.Unauthorized, rejected.StatusCode);
            Assert.Contains("Your session expired", await rejected.Content.ReadAsStringAsync());
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (File.Exists(dbPath)) File.Delete(dbPath);
        }
    }

    [Fact]
    public async Task A_cached_session_is_rejected_when_its_expiration_time_passes()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"nutrition-expired-session-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new Factory(dbPath);
            var token = Guid.NewGuid().ToString("N");
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                await db.Database.EnsureCreatedAsync();
                var user = await TestUsers.CreateAsync(db, "expired-session");
                db.CurrentUser = user.Id;
                db.Sessions.Add(new Session { UserId = user.Id, Hash = AuthService.Hash(token), Expires = DateTime.UtcNow.AddSeconds(3) });
                await db.SaveChangesAsync();
            }

            using var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("Cookie", $"{AuthService.Cookie}={token}");
            using (var active = await client.GetAsync("/api/auth/me")) Assert.Equal(HttpStatusCode.OK, active.StatusCode);
            await Task.Delay(TimeSpan.FromSeconds(3.2));
            using var expired = await client.GetAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.Unauthorized, expired.StatusCode);
            Assert.Contains("Your session expired", await expired.Content.ReadAsStringAsync());
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (File.Exists(dbPath)) File.Delete(dbPath);
        }
    }

    [Fact]
    public async Task Api_auth_errors_are_compressed_with_fastest_provider_levels()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"nutrition-compression-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new Factory(dbPath);
            Assert.Equal(CompressionLevel.Fastest, factory.Services.GetRequiredService<IOptions<GzipCompressionProviderOptions>>().Value.Level);
            Assert.Equal(CompressionLevel.Fastest, factory.Services.GetRequiredService<IOptions<BrotliCompressionProviderOptions>>().Value.Level);

            using var client = factory.CreateClient();
            client.DefaultRequestHeaders.AcceptEncoding.Add(new StringWithQualityHeaderValue("gzip"));
            using var response = await client.GetAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Contains("gzip", response.Content.Headers.ContentEncoding);
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (File.Exists(dbPath)) File.Delete(dbPath);
        }
    }
}