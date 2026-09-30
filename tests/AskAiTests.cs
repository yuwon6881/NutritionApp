using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Nutrition.Api.Services.AI;
using Nutrition.Api.Services.AI.Agent;
using Nutrition.Api.Services.AI.Tools;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Nutrition.Tests;

public sealed class AskAiTests
{
    private static async Task<(SqliteConnection Connection, AppDb Db, AppUser User)> CreateTestDbAsync()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "ai-test-user");
        db.CurrentUser = user.Id;
        return (connection, db, user);
    }

    [Fact]
    public void AiToolArgs_ValidatesAndParsesCorrectly()
    {
        var json = """
        {
            "query": "rolled oats",
            "limit": 10,
            "date": "2026-09-30",
            "ratio": 2.5,
            "tags": ["breakfast", "grain"]
        }
        """;
        var args = AiToolArgs.Parse(json);

        Assert.Equal("rolled oats", args.RequiredString("query"));
        Assert.Equal(10, args.OptionalInt("limit", 1, 20));
        Assert.Equal(new DateOnly(2026, 9, 30), args.OptionalDate("date"));
        Assert.Equal(2.5m, args.OptionalDecimal("ratio", 0, 5));
        Assert.Equal(2, args.OptionalStringArray("tags", 5).Count);
    }

    [Fact]
    public void AiToolArgs_ThrowsOnInvalidOrMissingValues()
    {
        var args = AiToolArgs.Parse("{\"limit\": 50}");
        Assert.Throws<AiToolArgumentException>(() => args.OptionalInt("limit", 1, 20));
        Assert.Throws<AiToolArgumentException>(() => args.RequiredString("missing"));
        Assert.Throws<AiToolArgumentException>(() => AiToolArgs.Parse("not-json"));
    }

    [Fact]
    public async Task AiActionProposer_EnforcesEvidenceBarrier()
    {
        var context = new AiToolContext("kcal", "kg", new DateOnly(2026, 9, 30));
        var validFoodCode = "food_12345";
        var unseenFoodCode = "food_99999";

        context.Evidence.Record(AiEvidenceLedger.Food, validFoodCode);

        var proposer = new AiActionProposer(context);

        // Proposing action for unverified food must be rejected
        var invalidProposalJson = JsonSerializer.Serialize(new
        {
            actions = new[]
            {
                new { type = "openAddFoodDraft", payload = new { foodId = unseenFoodCode } }
            }
        });

        var resultJson = await proposer.ProposeAsync(invalidProposalJson, CancellationToken.None);
        var resultNode = JsonNode.Parse(resultJson);
        var firstResult = resultNode?["results"]?[0];

        Assert.False(firstResult?["accepted"]?.GetValue<bool>());
        Assert.Empty(proposer.Accepted);

        // Proposing action for recorded food must be accepted
        var validProposalJson = JsonSerializer.Serialize(new
        {
            actions = new[]
            {
                new { type = "openAddFoodDraft", payload = new { foodId = validFoodCode } }
            }
        });

        var validResultJson = await proposer.ProposeAsync(validProposalJson, CancellationToken.None);
        var validResultNode = JsonNode.Parse(validResultJson);
        var validFirstResult = validResultNode?["results"]?[0];

        Assert.True(validFirstResult?["accepted"]?.GetValue<bool>());
        Assert.Single(proposer.Accepted);
        Assert.Equal("openAddFoodDraft", proposer.Accepted[0].Type);
    }

    [Fact]
    public async Task ConversationMemory_CreatesPersistsAndReplaysTurns()
    {
        var (connection, db, user) = await CreateTestDbAsync();
        await using (connection)
        await using (db)
        {
            var memory = new AiConversationMemoryService(db);

            var clientTurnId = "turn_nutrition_123";
            var request = new AiChatRequest(
                Message: "What was my calorie total yesterday?",
                History: null,
                ClientTurnId: clientTurnId);

            var prepared = await memory.PrepareAsync(request, CancellationToken.None);
            Assert.NotNull(prepared.Conversation);
            Assert.NotNull(prepared.PendingTurn);
            Assert.Equal(clientTurnId, prepared.ClientTurnId);

            var response = new AiChatResponse(
                Reply: "Yesterday you logged 2,150 kcal with 160g protein.",
                Actions: [new AiUiAction("openFoodLog", new Dictionary<string, object?> { ["date"] = "2026-09-29" })]);

            var completed = await memory.CompleteAsync(prepared, request.Message, response, CancellationToken.None);
            Assert.NotNull(completed);
            Assert.Equal(1, completed.ConversationVersion);
            Assert.Single(completed.Actions);

            // Replaying with identical clientTurnId returns completed response
            var replayPrepared = await memory.PrepareAsync(request, CancellationToken.None);
            Assert.NotNull(replayPrepared.Replay);
            Assert.Equal(response.Reply, replayPrepared.Replay.Reply);

            // Retrieve active conversation
            var active = await memory.GetActiveAsync(CancellationToken.None);
            Assert.Equal(completed.ConversationId, active.ConversationId);
            Assert.Equal(2, active.Messages.Count);
            Assert.Equal("user", active.Messages[0].Role);
            Assert.Equal(request.Message, active.Messages[0].Content);
            Assert.Equal("assistant", active.Messages[1].Role);
            Assert.Equal(response.Reply, active.Messages[1].Content);
        }
    }

    [Fact]
    public async Task GetDailySummaryTool_CalculatesTotalsAndTargets()
    {
        var (connection, db, user) = await CreateTestDbAsync();
        await using (connection)
        await using (db)
        {
            var today = new DateOnly(2026, 9, 30);

            // Seed accepted coaching plan
            var planResult = new CoachResult(true, true, 2200, 2500, 160, 70, 230, "Plan explanation");
            db.Plans.Add(new AcceptedPlan
            {
                UserId = user.Id,
                Date = today.AddDays(-2),
                ResultJson = Json.Write(planResult),
                ProfileJson = "{}"
            });

            // Seed diary entries for today
            db.Entries.Add(new DiaryEntry
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Date = today,
                Name = "Eggs & Toast",
                Calories = 450,
                Protein = 25,
                Fat = 18,
                Carbs = 42
            });
            db.Entries.Add(new DiaryEntry
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Date = today,
                Name = "Chicken & Rice",
                Calories = 650,
                Protein = 55,
                Fat = 12,
                Carbs = 78
            });
            await db.SaveChangesAsync();

            var tool = new GetDailySummaryTool(db);
            var context = new AiToolContext("kcal", "kg", today);

            var result = await tool.ExecuteAsync(AiToolArgs.Parse($"{{\"date\":\"{today:yyyy-MM-dd}\"}}"), context, CancellationToken.None);
            Assert.NotNull(result.Data);

            var json = JsonSerializer.Serialize(result.Data);
            var doc = JsonDocument.Parse(json);
            var daysArray = doc.RootElement.GetProperty("days");
            Assert.Equal(1, daysArray.GetArrayLength());

            var day = daysArray[0];
            Assert.Equal(1100, day.GetProperty("calories").GetDouble());
            Assert.Equal(80, day.GetProperty("protein").GetDouble());
            Assert.Equal(30, day.GetProperty("fat").GetDouble());
            Assert.Equal(120, day.GetProperty("carbs").GetDouble());
            Assert.Equal(2200, day.GetProperty("targets").GetProperty("calories").GetDouble());
        }
    }

    [Fact]
    public async Task GetFoodLogTool_ReturnsLoggedItemsAndRecordsEvidence()
    {
        var (connection, db, user) = await CreateTestDbAsync();
        await using (connection)
        await using (db)
        {
            var today = new DateOnly(2026, 9, 30);
            var entryId = Guid.NewGuid();
            db.Entries.Add(new DiaryEntry
            {
                Id = entryId,
                UserId = user.Id,
                Date = today,
                Time = "12:30",
                Name = "Greek Yogurt Bowl",
                Calories = 320,
                Protein = 28,
                Carbs = 35,
                Fat = 6,
                Fiber = 4
            });
            await db.SaveChangesAsync();

            var tool = new GetFoodLogTool(db);
            var context = new AiToolContext("kcal", "kg", today);

            var result = await tool.ExecuteAsync(AiToolArgs.Parse($"{{\"date\":\"{today:yyyy-MM-dd}\"}}"), context, CancellationToken.None);
            Assert.NotNull(result.Data);

            var json = JsonSerializer.Serialize(result.Data);
            var doc = JsonDocument.Parse(json);
            Assert.Equal(1, doc.RootElement.GetProperty("itemCount").GetInt32());
            Assert.Equal(320, doc.RootElement.GetProperty("totals").GetProperty("calories").GetDouble());

            Assert.True(context.Evidence.Contains(AiEvidenceLedger.FoodLog, entryId.ToString()));
        }
    }

    [Fact]
    public async Task AiChatUsageMeter_TracksTokenUsage()
    {
        var (connection, db, user) = await CreateTestDbAsync();
        await using (connection)
        await using (db)
        {
            var meter = new AiChatUsageMeter(db, NullLogger<AiChatUsageMeter>.Instance);
            var today = DateOnly.FromDateTime(DateTime.UtcNow);

            var usage1 = new AiTokenUsage(100, 20, 50, 10);
            await meter.RecordAsync(usage1, 1, CancellationToken.None);

            var record = await db.Usage.SingleAsync(u => u.Date == today);
            Assert.Equal(100, record.ChatInputTokens);
            Assert.Equal(20, record.ChatCachedTokens);
            Assert.Equal(50, record.ChatOutputTokens);
            Assert.Equal(10, record.ChatReasoningTokens);
            Assert.Equal(1, record.ChatCalls);

            var usage2 = new AiTokenUsage(50, 10, 25, 5);
            await meter.RecordAsync(usage2, 1, CancellationToken.None);

            var updated = await db.Usage.SingleAsync(u => u.Date == today);
            Assert.Equal(150, updated.ChatInputTokens);
            Assert.Equal(30, updated.ChatCachedTokens);
            Assert.Equal(75, updated.ChatOutputTokens);
            Assert.Equal(15, updated.ChatReasoningTokens);
            Assert.Equal(2, updated.ChatCalls);
        }
    }
}
