using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Nutrition.Api.Services.AI.Tools;
using Xunit;

namespace Nutrition.Tests;

public sealed class AskAiCoachingHistoryTests
{
    private static readonly DateOnly Today = new(2026, 9, 30);

    private static async Task<(SqliteConnection Connection, AppDb Db, AppUser User)> CreateAsync()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "history-user");
        db.CurrentUser = user.Id;
        return (connection, db, user);
    }

    private static AcceptedPlan Plan(Guid userId, DateOnly date, double calories, bool deleted = false) => new()
    {
        Id = Guid.NewGuid(), UserId = userId, Date = date, Deleted = deleted, ProfileJson = "{}",
        ResultJson = Json.Write(new CoachResult(true, true, calories, calories + 400, 160, 70, 230, "plan")
            { EffectiveGoal = "lose", GoalRatePercent = 0.5 })
    };

    private static async Task<JsonNode> Run(AppDb db, AiToolContext context, string args = "{}")
    {
        var result = await new GetCoachingHistoryTool(db).ExecuteAsync(AiToolArgs.Parse(args), context, CancellationToken.None);
        return JsonNode.Parse(JsonSerializer.Serialize(result.Data))!;
    }

    [Fact]
    public async Task ReportsOwnPlansDecisionsAndGoalNewestFirstWithoutTracking()
    {
        var (connection, db, user) = await CreateAsync();
        await using (connection)
        await using (db)
        {
            user.ProfileJson = Json.Write(new Profile
            {
                Age = 30, HeightCm = 180, WeightKg = 90, Sex = "male", Goal = "lose", PhaseMode = "weight",
                TargetWeightKg = 80, GoalRatePercent = 0.5, ActivityLevel = ActivityLevels.Lifting,
                PregnancyOrBreastfeeding = true, MedicalNutrition = true
            });
            db.Plans.Add(Plan(user.Id, Today.AddDays(-14), 2400));
            db.Plans.Add(Plan(user.Id, Today.AddDays(-7), 2300));
            db.Plans.Add(Plan(user.Id, Today.AddDays(-1), 1000, deleted: true));
            db.CheckIns.Add(new CheckInDecision { Id = Guid.NewGuid(), UserId = user.Id, Date = Today.AddDays(-3), WeekStart = Today.AddDays(-3) });
            db.PhaseDecisions.Add(new PhaseDecision { Id = Guid.NewGuid(), UserId = user.Id, Date = Today.AddDays(-2), Decision = "completed", ReachedBy = "trend" });
            await db.SaveChangesAsync();

            var other = await TestUsers.CreateAsync(db, "other-user");
            db.CurrentUser = other.Id;
            db.Plans.Add(Plan(other.Id, Today, 3500));
            await db.SaveChangesAsync();
            db.CurrentUser = user.Id;
            db.ChangeTracker.Clear();

            var context = new AiToolContext("kj", "lb", Today);
            var node = await Run(db, context);

            var plans = node["acceptedPlans"]!.AsArray();
            Assert.Equal(2, plans.Count);
            Assert.Equal("2026-09-23", plans[0]!["date"]!.GetValue<string>());
            Assert.Equal(Math.Round(2300 * 4.184), plans[0]!["calories"]!.GetValue<double>());
            Assert.Equal(Math.Round(2700 * 4.184), plans[0]!["estimatedExpenditure"]!.GetValue<double>());
            Assert.Equal("lose", plans[0]!["goal"]!.GetValue<string>());
            Assert.Equal("kept current targets", node["checkInDecisions"]![0]!["decision"]!.GetValue<string>());
            Assert.StartsWith("goal phase completed", node["phaseDecisions"]![0]!["decision"]!.GetValue<string>());

            var goal = node["goal"]!;
            Assert.Equal(Math.Round(80 * 2.20462, 1), goal["targetWeight"]!.GetValue<double>());
            Assert.Equal("Lifting", goal["activityLevel"]!.GetValue<string>());
            Assert.Equal(30, goal["age"]!.GetValue<int>());
            var text = node.ToJsonString();
            Assert.DoesNotContain("regnan", text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("medical", text, StringComparison.OrdinalIgnoreCase);

            Assert.False(node["moreHistoryAvailable"]!.GetValue<bool>());
            Assert.True(context.Evidence.Contains(AiEvidenceLedger.Coaching, "history"));
            Assert.Empty(db.ChangeTracker.Entries());
        }
    }

    [Fact]
    public async Task LimitBoundsEachKindAndFlagsOlderHistory()
    {
        var (connection, db, user) = await CreateAsync();
        await using (connection)
        await using (db)
        {
            for (var week = 0; week < 25; week++) db.Plans.Add(Plan(user.Id, Today.AddDays(-7 * week), 2000 + week));
            await db.SaveChangesAsync();
            var context = new AiToolContext("kcal", "kg", Today);

            var node = await Run(db, context, "{\"limit\":3}");
            Assert.Equal(3, node["acceptedPlans"]!.AsArray().Count);
            Assert.True(node["moreHistoryAvailable"]!.GetValue<bool>());

            var fallback = await Run(db, context);
            Assert.Equal(8, fallback["acceptedPlans"]!.AsArray().Count);
            await Assert.ThrowsAsync<AiToolArgumentException>(() => Run(db, context, "{\"limit\":50}"));
        }
    }

    [Fact]
    public async Task UnreadableSnapshotsAndMissingProfileStayUnknown()
    {
        var (connection, db, user) = await CreateAsync();
        await using (connection)
        await using (db)
        {
            db.Plans.Add(new AcceptedPlan { Id = Guid.NewGuid(), UserId = user.Id, Date = Today, ResultJson = "not-json", ProfileJson = "{}" });
            await db.SaveChangesAsync();

            var node = await Run(db, new AiToolContext("kcal", "kg", Today));
            Assert.Null(node["goal"]);
            var plan = node["acceptedPlans"]![0]!;
            Assert.Equal("2026-09-30", plan["date"]!.GetValue<string>());
            Assert.Null(plan["calories"]);
            Assert.Null(plan["protein"]);
        }
    }
}
