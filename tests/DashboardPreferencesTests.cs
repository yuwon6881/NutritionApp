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

public sealed class DashboardPreferencesTests
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

    private static async Task<AppDb> Open()
    {
        var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite("Data Source=:memory:").Options);
        await db.Database.OpenConnectionAsync();
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "dash-pref");
        db.CurrentUser = user.Id;
        return db;
    }

    private static Mutation Op(string kind, Guid id, long revision, object data, bool delete = false)
        => new(Guid.NewGuid(), kind, id, revision, JsonSerializer.SerializeToElement(data, Json.Options), delete);

    [Fact]
    public async Task Dashboard_preferences_are_saved_and_partially_updated()
    {
        await using var db = await Open();
        var user = await db.Users.SingleAsync();
        var sync = new SyncService(db);

        // Initially null
        Assert.Null(user.ProgressTab);
        Assert.Null(user.WeightChartView);
        Assert.Null(user.EnergyChartView);
        Assert.Null(user.WeightPeriod);
        Assert.Null(user.EnergyPeriod);

        // Update all dashboard preferences
        var r1 = await sync.Apply(Op("settings", user.Id, user.CoachingSettingsRevision, new
        {
            progressTab = "energy",
            weightChartView = "trend",
            energyChartView = "balance",
            weightPeriod = "six-months",
            energyPeriod = "year"
        }), default);

        var saved = await db.Users.SingleAsync(u => u.Id == user.Id);
        Assert.Equal(r1, saved.CoachingSettingsRevision);
        Assert.Equal("energy", saved.ProgressTab);
        Assert.Equal("trend", saved.WeightChartView);
        Assert.Equal("balance", saved.EnergyChartView);
        Assert.Equal("six-months", saved.WeightPeriod);
        Assert.Equal("year", saved.EnergyPeriod);

        // Partial update leaves other fields untouched
        var r2 = await sync.Apply(Op("settings", user.Id, r1, new
        {
            weightChartView = "scale"
        }), default);

        saved = await db.Users.SingleAsync(u => u.Id == user.Id);
        Assert.Equal(r2, saved.CoachingSettingsRevision);
        Assert.Equal("energy", saved.ProgressTab);
        Assert.Equal("scale", saved.WeightChartView);
        Assert.Equal("balance", saved.EnergyChartView);
        Assert.Equal("six-months", saved.WeightPeriod);
        Assert.Equal("year", saved.EnergyPeriod);

        // Maintenance and coaching views are supported for energy chart, and both for weight
        var r3 = await sync.Apply(Op("settings", user.Id, r2, new
        {
            energyChartView = "maintenance",
            weightChartView = "both"
        }), default);

        saved = await db.Users.SingleAsync(u => u.Id == user.Id);
        Assert.Equal(r3, saved.CoachingSettingsRevision);
        Assert.Equal("both", saved.WeightChartView);
        Assert.Equal("maintenance", saved.EnergyChartView);

        var r4 = await sync.Apply(Op("settings", user.Id, r3, new
        {
            energyChartView = "coaching"
        }), default);

        saved = await db.Users.SingleAsync(u => u.Id == user.Id);
        Assert.Equal(r4, saved.CoachingSettingsRevision);
        Assert.Equal("coaching", saved.EnergyChartView);
    }

    [Theory]
    [InlineData("progressTab", "invalid_tab", "Choose a valid progress tab.")]
    [InlineData("weightChartView", "invalid_view", "Choose a valid weight chart view.")]
    [InlineData("energyChartView", "invalid_view", "Choose a valid energy chart view.")]
    [InlineData("weightPeriod", "invalid_period", "Choose a valid weight period.")]
    [InlineData("energyPeriod", "invalid_period", "Choose a valid energy period.")]
    public async Task Invalid_dashboard_preferences_are_rejected(string field, string invalidValue, string expectedMessage)
    {
        await using var db = await Open();
        var user = await db.Users.SingleAsync();
        var sync = new SyncService(db);

        var dict = new Dictionary<string, object> { [field] = invalidValue };
        var ex = await Assert.ThrowsAsync<DomainException>(() =>
            sync.Apply(Op("settings", user.Id, user.CoachingSettingsRevision, dict), default));

        Assert.Equal(expectedMessage, ex.Message);
    }

    [Fact]
    public async Task Dashboard_preferences_are_returned_in_bootstrap_and_state()
    {
        var tempDb = Path.Combine(Path.GetTempPath(), $"nutrition-test-{Guid.NewGuid():N}.db");
        try
        {
            using var factory = new TestFactory(tempDb);
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            await db.Database.EnsureCreatedAsync();

            var user = await TestUsers.CreateAsync(db, "alice");
            db.MaintenanceAccess = true;

            user.ProgressTab = "energy";
            user.WeightChartView = "scale";
            user.EnergyChartView = "balance";
            user.WeightPeriod = "week";
            user.EnergyPeriod = "month";

            var token = Guid.NewGuid().ToString("N");
            db.Sessions.Add(new Session
            {
                UserId = user.Id,
                Hash = AuthService.Hash(token),
                Expires = DateTime.UtcNow.AddDays(1)
            });
            await db.SaveChangesAsync();

            var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            client.DefaultRequestHeaders.Add("X-Nutrition-Request", "1");
            client.DefaultRequestHeaders.Add("Origin", "https://localhost");
            client.DefaultRequestHeaders.Add("Cookie", $"{AuthService.Cookie}={token}");

            var bootstrapRes = await client.GetAsync("/api/bootstrap");
            Assert.Equal(HttpStatusCode.OK, bootstrapRes.StatusCode);
            var bootstrap = await bootstrapRes.Content.ReadFromJsonAsync<JsonElement>();
            var settings = bootstrap.GetProperty("settings");
            Assert.Equal("energy", settings.GetProperty("progressTab").GetString());
            Assert.Equal("scale", settings.GetProperty("weightChartView").GetString());
            Assert.Equal("balance", settings.GetProperty("energyChartView").GetString());
            Assert.Equal("week", settings.GetProperty("weightPeriod").GetString());
            Assert.Equal("month", settings.GetProperty("energyPeriod").GetString());

            var stateRes = await client.GetAsync("/api/state");
            Assert.Equal(HttpStatusCode.OK, stateRes.StatusCode);
            var state = await stateRes.Content.ReadFromJsonAsync<JsonElement>();
            var stateSettings = state.GetProperty("settings");
            Assert.Equal("energy", stateSettings.GetProperty("progressTab").GetString());
            Assert.Equal("scale", stateSettings.GetProperty("weightChartView").GetString());
            Assert.Equal("balance", stateSettings.GetProperty("energyChartView").GetString());
            Assert.Equal("week", stateSettings.GetProperty("weightPeriod").GetString());
            Assert.Equal("month", stateSettings.GetProperty("energyPeriod").GetString());
        }
        finally
        {
            try { if (File.Exists(tempDb)) File.Delete(tempDb); } catch { }
        }
    }

    [Fact]
    public async Task Dashboard_preferences_update_does_not_invalidate_coaching_proposal()
    {
        await using var db = await Open();
        var user = await db.Users.SingleAsync();
        var sync = new SyncService(db);
        var coach = new CoachingService(db, new ExpenditureTrajectoryService(db));

        var profile = new Profile { Age = 30, HeightCm = 175, WeightKg = 80, Sex = "male", Activity = 1.4, Goal = "maintain", Maintenance = 2500 };
        await sync.Apply(Op("profile", user.Id, 0, profile), default);

        var preview = await coach.Preview(default);
        Assert.True(preview.CanAccept);

        // Update dashboard preference (e.g. switch chart view)
        await sync.Apply(Op("settings", user.Id, user.CoachingSettingsRevision, new
        {
            energyChartView = "coaching"
        }), default);

        // Accepting the proposal with the previously obtained preview.Revision succeeds
        var planId = Guid.NewGuid();
        var plan = await coach.Accept(planId, preview.Revision, default);
        Assert.Equal(planId, plan.Id);
    }
}
