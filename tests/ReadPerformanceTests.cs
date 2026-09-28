using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

[CollectionDefinition("Synthetic read performance", DisableParallelization = true)]
public sealed class ReadPerformanceCollection { }

/// <summary>Isolated SQLite/provider-free baselines, never production latency assertions.</summary>
[Collection("Synthetic read performance")]
public sealed class ReadPerformanceTests
{
    private sealed class Factory(string path) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string,string?>
            {
                ["Database:SqlitePath"] = path,
                ["PublicOrigin"] = "https://localhost",
                ["RateLimits:Progress:PermitLimit"] = "1000"
            }));
        }
    }

    [Theory]
    [InlineData(7)]
    [InlineData(365)]
    [InlineData(3650)]
    public async Task Synthetic_reads_preserve_history_and_record_cold_and_warm_timings(int days)
    {
        var path = Path.Combine(Path.GetTempPath(), $"nutrition-performance-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new Factory(path);
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();
            var user = await TestUsers.CreateAsync(db, "performance");
            user.ProfileJson = Json.Write(new Profile {Age=30,HeightCm=175,WeightKg=80,Sex="male",Activity=1.4,Goal="maintain",Maintenance=2400,TimeZone="UTC"});
            user.Revision = 1;
            db.CurrentUser = user.Id;
            var today = RetentionService.Today(user.ProfileJson);
            for (var i = 0; i < days; i++)
            {
                var date = today.AddDays(-i);
                db.Weights.Add(new Weight {Id=Guid.NewGuid(),UserId=user.Id,Date=date,Kg=80+i%4*.1});
                db.Days.Add(new DayStatus {Id=Guid.NewGuid(),UserId=user.Id,Date=date,Status="complete",Archived=i>=90,Calories=1600,EntryCount=8});
                if (i < 90) for (var meal = 0; meal < 8; meal++)
                    db.Entries.Add(new DiaryEntry {Id=Guid.NewGuid(),UserId=user.Id,Date=date,Name="Synthetic food",Calories=200,Source="manual",Quantity=100,Unit="g"});
            }
            var token = Guid.NewGuid().ToString("N");
            db.Sessions.Add(new Session {UserId=user.Id,Hash=AuthService.Hash(token),Expires=DateTime.UtcNow.AddDays(1)});
            await db.SaveChangesAsync();
            using var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("Cookie", $"{AuthService.Cookie}={token}");
            long commands = 0;
            using var listener = new MeterListener();
            listener.InstrumentPublished = (instrument, meter) =>
            {
                if (instrument.Meter.Name == "Fitness.Nutrition.Database" && instrument.Name == "db.command.count")
                    meter.EnableMeasurementEvents(instrument);
            };
            listener.SetMeasurementEventCallback<long>((_, value, _, _) => Interlocked.Add(ref commands,value));
            listener.Start();
            var samples = new List<object>();
            foreach (var resource in new[] {"/api/bootstrap", "/api/progress/summary?period=all"})
            {
                for (var run = 0; run < 25; run++)
                {
                    if (run < 5 && factory.Services.GetRequiredService<IMemoryCache>() is MemoryCache cache) cache.Clear();
                    var before = Interlocked.Read(ref commands);
                    var timer = Stopwatch.StartNew();
                    using var response = await client.GetAsync(resource);
                    var body = await response.Content.ReadAsByteArrayAsync();
                    timer.Stop();
                    Assert.Equal(HttpStatusCode.OK,response.StatusCode);
                    using var json = JsonDocument.Parse(body);
                    if (resource.Contains("progress")) Assert.Equal(days,json.RootElement.GetProperty("weight").GetProperty("statistics").GetProperty("count").GetInt32());
                    samples.Add(new {resource,run,kind=run<5?"cold-request-cache":"warm",durationMs=timer.Elapsed.TotalMilliseconds,
                        sqlCommands=Interlocked.Read(ref commands)-before,responseBodyBytes=body.Length});
                }
            }
            var output = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"../../../../artifacts/performance"));
            Directory.CreateDirectory(output);
            await File.WriteAllTextAsync(Path.Combine(output,$"api-{days}.json"),JsonSerializer.Serialize(new {days,database="isolated SQLite",samples},new JsonSerializerOptions {WriteIndented=true}));
        }
        finally
        {
            SqliteCleanup(path);
        }
    }

    private static void SqliteCleanup(string path)
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (var suffix in new[] {"", "-shm", "-wal"})
            if (File.Exists(path+suffix)) File.Delete(path+suffix);
    }
}
