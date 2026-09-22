using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
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

public class DiaryEndpointsTests
{
    private sealed class TestFactory(string dbPath) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Database:SqlitePath"] = dbPath,
                    ["PublicOrigin"] = "https://localhost"
                });
            });
        }
    }

    private static async Task WithClient(Func<HttpClient, AppDb, AppUser, AppUser, Task> test)
    {
        var tempDb = Path.Combine(Path.GetTempPath(), $"nutrition-test-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new TestFactory(tempDb);
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();

            var userA = await TestUsers.CreateAsync(db, "alice");
            var userB = await TestUsers.CreateAsync(db, "bob");
            db.MaintenanceAccess = true;

            var tokenA = Guid.NewGuid().ToString("N");
            db.Sessions.Add(new Session
            {
                UserId = userA.Id,
                Hash = AuthService.Hash(tokenA),
                Expires = DateTime.UtcNow.AddDays(1)
            });
            await db.SaveChangesAsync();

            var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            client.DefaultRequestHeaders.Add("X-Nutrition-Request", "1");
            client.DefaultRequestHeaders.Add("Origin", "https://localhost");
            client.DefaultRequestHeaders.Add("Cookie", $"{AuthService.Cookie}={tokenA}");

            await test(client, db, userA, userB);
        }
        finally
        {
            try { File.Delete(tempDb); } catch { }
        }
    }

    [Fact]
    public async Task Diary_date_bounds_validation()
    {
        await WithClient(async (client, db, userA, userB) =>
        {
            var today = RetentionService.Today(userA.ProfileJson);

            // Missing parameters
            var res1 = await client.GetAsync("/api/diary");
            Assert.Equal(HttpStatusCode.BadRequest, res1.StatusCode);

            // from > to
            var res2 = await client.GetAsync($"/api/diary?from={today:yyyy-MM-dd}&to={today.AddDays(-1):yyyy-MM-dd}");
            Assert.Equal(HttpStatusCode.BadRequest, res2.StatusCode);

            // Exceeds 31 days (32 days)
            var res3 = await client.GetAsync($"/api/diary?from={today.AddDays(-31):yyyy-MM-dd}&to={today:yyyy-MM-dd}");
            Assert.Equal(HttpStatusCode.BadRequest, res3.StatusCode);
            var err3 = await res3.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Contains("31 days", err3.GetProperty("message").GetString());

            // Prior to 2000-01-01
            var res4 = await client.GetAsync("/api/diary?from=1999-12-31&to=2000-01-05");
            Assert.Equal(HttpStatusCode.BadRequest, res4.StatusCode);

            // Future date beyond today
            var res5 = await client.GetAsync($"/api/diary?from={today:yyyy-MM-dd}&to={today.AddDays(1):yyyy-MM-dd}");
            Assert.Equal(HttpStatusCode.BadRequest, res5.StatusCode);

            // Exactly 31 days passes
            var res6 = await client.GetAsync($"/api/diary?from={today.AddDays(-30):yyyy-MM-dd}&to={today:yyyy-MM-dd}");
            Assert.Equal(HttpStatusCode.OK, res6.StatusCode);

            // Single day passes
            var res7 = await client.GetAsync($"/api/diary?from={today:yyyy-MM-dd}&to={today:yyyy-MM-dd}");
            Assert.Equal(HttpStatusCode.OK, res7.StatusCode);
        });
    }

    [Fact]
    public async Task Diary_and_bootstrap_enforce_account_isolation()
    {
        await WithClient(async (client, db, userA, userB) =>
        {
            var today = RetentionService.Today(userA.ProfileJson);

            // Seed entries for user A and user B
            db.Entries.AddRange(
                new DiaryEntry { Id = Guid.NewGuid(), UserId = userA.Id, Date = today, Name = "Alice Apple", Calories = 95, Time = "08:00" },
                new DiaryEntry { Id = Guid.NewGuid(), UserId = userB.Id, Date = today, Name = "Bob Banana", Calories = 105, Time = "09:00" }
            );
            db.Foods.AddRange(
                new Food { Id = Guid.NewGuid(), UserId = userA.Id, Name = "Alice Oats", Calories = 350, ServingGrams = 100, IngredientsJson = "[]", PortionsJson = "[]" },
                new Food { Id = Guid.NewGuid(), UserId = userB.Id, Name = "Bob Berries", Calories = 60, ServingGrams = 100, IngredientsJson = "[]", PortionsJson = "[]" }
            );
            db.Weights.AddRange(
                new Weight { Id = Guid.NewGuid(), UserId = userA.Id, Date = today, Kg = 80, Context = "stress" },
                new Weight { Id = Guid.NewGuid(), UserId = userB.Id, Date = today, Kg = 70, Context = "bloating" }
            );
            await db.SaveChangesAsync();

            // Client is authenticated as Alice
            var diaryRes = await client.GetAsync($"/api/diary?from={today:yyyy-MM-dd}&to={today:yyyy-MM-dd}");
            Assert.Equal(HttpStatusCode.OK, diaryRes.StatusCode);
            var diary = await diaryRes.Content.ReadFromJsonAsync<JsonElement>();
            var entries = diary.GetProperty("entries").EnumerateArray().ToList();
            Assert.Single(entries);
            Assert.Equal("Alice Apple", entries[0].GetProperty("name").GetString());

            var bootstrapRes = await client.GetAsync("/api/bootstrap");
            Assert.Equal(HttpStatusCode.OK, bootstrapRes.StatusCode);
            var bootstrap = await bootstrapRes.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(userA.Id.ToString(), bootstrap.GetProperty("id").GetString());
            var bEntries = bootstrap.GetProperty("entries").EnumerateArray().ToList();
            Assert.Single(bEntries);
            Assert.Equal("Alice Apple", bEntries[0].GetProperty("name").GetString());
            var bWeights = bootstrap.GetProperty("weights").EnumerateArray().ToList();
            Assert.Single(bWeights);
            Assert.Equal("stress", bWeights[0].GetProperty("context").GetString());

            var foodsRes = await client.GetAsync("/api/foods");
            Assert.Equal(HttpStatusCode.OK, foodsRes.StatusCode);
            var foodsObj = await foodsRes.Content.ReadFromJsonAsync<JsonElement>();
            var foods = foodsObj.GetProperty("foods").EnumerateArray().ToList();
            Assert.Single(foods);
            Assert.Equal("Alice Oats", foods[0].GetProperty("name").GetString());
        });
    }

    [Fact]
    public async Task Empty_and_archived_days_in_diary()
    {
        await WithClient(async (client, db, userA, userB) =>
        {
            var today = RetentionService.Today(userA.ProfileJson);
            var pastDate = today.AddDays(-20);

            // Seed an archived day summary without detail entries
            db.Days.Add(new DayStatus
            {
                Id = Guid.NewGuid(),
                UserId = userA.Id,
                Date = pastDate,
                Status = "complete",
                Archived = true,
                Calories = 2100,
                Protein = 150,
                Carbs = 200,
                Fat = 70,
                EntryCount = 5
            });
            await db.SaveChangesAsync();

            var res = await client.GetAsync($"/api/diary?from={pastDate.AddDays(-1):yyyy-MM-dd}&to={pastDate.AddDays(1):yyyy-MM-dd}");
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            var doc = await res.Content.ReadFromJsonAsync<JsonElement>();

            // entries is empty because archived days have no detail entries
            Assert.Empty(doc.GetProperty("entries").EnumerateArray().ToList());

            // days has 1 day
            var days = doc.GetProperty("days").EnumerateArray().ToList();
            Assert.Single(days);
            Assert.True(days[0].GetProperty("archived").GetBoolean());
            Assert.Equal(2100, days[0].GetProperty("calories").GetInt32());
            Assert.Equal(5, days[0].GetProperty("entryCount").GetInt32());
            Assert.Equal("complete", days[0].GetProperty("status").GetString());
        });
    }

    [Fact]
    public async Task Conditional_responses_support_304_not_modified()
    {
        await WithClient(async (client, db, userA, userB) =>
        {
            var today = RetentionService.Today(userA.ProfileJson);

            // 1. /api/diary
            var diaryUrl = $"/api/diary?from={today:yyyy-MM-dd}&to={today:yyyy-MM-dd}";
            var res1 = await client.GetAsync(diaryUrl);
            Assert.Equal(HttpStatusCode.OK, res1.StatusCode);
            var etag1 = res1.Headers.ETag?.ToString();
            Assert.NotNull(etag1);

            // Send If-None-Match
            var req1 = new HttpRequestMessage(HttpMethod.Get, diaryUrl);
            req1.Headers.TryAddWithoutValidation("If-None-Match", etag1);
            var res1NotMod = await client.SendAsync(req1);
            Assert.Equal(HttpStatusCode.NotModified, res1NotMod.StatusCode);

            // 2. /api/bootstrap
            var bRes1 = await client.GetAsync("/api/bootstrap");
            Assert.Equal(HttpStatusCode.OK, bRes1.StatusCode);
            var bEtag = bRes1.Headers.ETag?.ToString();
            Assert.NotNull(bEtag);

            var bReqNotMod = new HttpRequestMessage(HttpMethod.Get, "/api/bootstrap");
            bReqNotMod.Headers.TryAddWithoutValidation("If-None-Match", bEtag);
            var bResNotMod = await client.SendAsync(bReqNotMod);
            Assert.Equal(HttpStatusCode.NotModified, bResNotMod.StatusCode);

            // 3. /api/foods
            var fRes1 = await client.GetAsync("/api/foods");
            Assert.Equal(HttpStatusCode.OK, fRes1.StatusCode);
            var fEtag = fRes1.Headers.ETag?.ToString();
            Assert.NotNull(fEtag);

            var fReqNotMod = new HttpRequestMessage(HttpMethod.Get, "/api/foods");
            fReqNotMod.Headers.TryAddWithoutValidation("If-None-Match", fEtag);
            var fResNotMod = await client.SendAsync(fReqNotMod);
            Assert.Equal(HttpStatusCode.NotModified, fResNotMod.StatusCode);

            // 4. Lightweight domain revisions used by the foreground coordinator
            var revisionRes = await client.GetAsync("/api/revisions");
            Assert.Equal(HttpStatusCode.OK, revisionRes.StatusCode);
            var revisionEtag = revisionRes.Headers.ETag?.ToString();
            Assert.NotNull(revisionEtag);
            var revisions = await revisionRes.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(revisions.TryGetProperty("diary", out _));
            Assert.True(revisions.TryGetProperty("localDay", out _));

            var revisionReq = new HttpRequestMessage(HttpMethod.Get, "/api/revisions");
            revisionReq.Headers.TryAddWithoutValidation("If-None-Match", revisionEtag);
            var revisionNotMod = await client.SendAsync(revisionReq);
            Assert.Equal(HttpStatusCode.NotModified, revisionNotMod.StatusCode);
        });
    }

    [Fact]
    public async Task Compatibility_state_endpoint_remains_intact()
    {
        await WithClient(async (client, db, userA, userB) =>
        {
            var today = RetentionService.Today(userA.ProfileJson);
            db.Entries.Add(new DiaryEntry { Id = Guid.NewGuid(), UserId = userA.Id, Date = today, Name = "Salad", Calories = 150, Time = "12:00" });
            db.Foods.Add(new Food { Id = Guid.NewGuid(), UserId = userA.Id, Name = "Lettuce", Calories = 15, ServingGrams = 100, IngredientsJson = "[]", PortionsJson = "[]" });
            await db.SaveChangesAsync();

            var res = await client.GetAsync("/api/state");
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            var state = await res.Content.ReadFromJsonAsync<JsonElement>();

            Assert.Equal(userA.Id.ToString(), state.GetProperty("id").GetString());
            Assert.True(state.TryGetProperty("entries", out var entries));
            Assert.True(state.TryGetProperty("foods", out var foods));
            Assert.True(state.TryGetProperty("weights", out var weights));
            Assert.True(state.TryGetProperty("plans", out var plans));
            Assert.True(state.TryGetProperty("trainingSummaries", out var training));
            Assert.Single(entries.EnumerateArray().ToList());
            Assert.Single(foods.EnumerateArray().ToList());
        });
    }
}
