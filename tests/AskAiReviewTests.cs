using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Nutrition.Api.Services.AI;
using Nutrition.Api.Services.AI.Agent;
using Nutrition.Api.Services.AI.Tools;
using Xunit;

namespace Nutrition.Tests;

public sealed class AskAiReviewTests
{
    [Fact]
    public async Task SchedulerPrunesExpiredAndAbandonedTurns()
    {
        var (connection, db) = await CreateAsync();
        await using var connectionLifetime = connection;
        await using var dbLifetime = db;
        var conversation = new AiConversation { UserId = db.CurrentUser!.Value };
        db.AiConversations.Add(conversation);
        db.AiConversationTurns.AddRange(
            new AiConversationTurn { UserId = db.CurrentUser.Value, ConversationId = conversation.Id, ClientTurnId = "old",
                CreatedAt = DateTime.UtcNow.AddDays(-100), Status = "Completed" },
            new AiConversationTurn { UserId = db.CurrentUser.Value, ConversationId = conversation.Id, ClientTurnId = "stuck",
                CreatedAt = DateTime.UtcNow.AddMinutes(-11), Status = "Pending" },
            new AiConversationTurn { UserId = db.CurrentUser.Value, ConversationId = conversation.Id, ClientTurnId = "recent",
                CreatedAt = DateTime.UtcNow.AddDays(-1), Status = "Completed" });
        await db.SaveChangesAsync();
        var config = new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build();
        using var cache = new Microsoft.Extensions.Caching.Memory.MemoryCache(new Microsoft.Extensions.Caching.Memory.MemoryCacheOptions());
        var storage = new Nutrition.Api.Services.StorageService(db, cache,
            new Nutrition.Api.Services.TemporaryImageStore(new HttpClient(), config), config);
        await storage.Cleanup(default);
        var remaining = await db.AiConversationTurns.AsNoTracking().SingleAsync();
        Assert.Equal("recent", remaining.ClientTurnId);
    }


    [Fact]
    public async Task SummaryUsesArchivedTotalsUnknownMacrosAndHistoricalDatedTargets()
    {
        var (connection, db) = await CreateAsync();
        await using var connectionLifetime = connection;
        await using var dbLifetime = db;
        var today = new DateOnly(2026, 9, 30);
        var historical = today.AddDays(-10);
        db.Days.Add(new DayStatus { Id = Guid.NewGuid(), UserId = db.CurrentUser!.Value,
            Date = historical, Archived = true, Status = "complete", EntryCount = 3, Calories = 1800, Protein = null });
        db.Plans.Add(new AcceptedPlan { Id = Guid.NewGuid(), UserId = db.CurrentUser.Value,
            Date = historical.AddDays(-1), ResultJson = Json.Write(new CoachResult(true, false, 2000, 2500, 150, 60, 210, "old")
                { DailyCalories = [1900, 1900, 2100, 1900, 1900, 2200, 2200] }), ProfileJson = "{}" });
        db.Plans.Add(new AcceptedPlan { Id = Guid.NewGuid(), UserId = db.CurrentUser.Value,
            Date = today, ResultJson = Json.Write(new CoachResult(true, false, 2400, 2500, 180, 80, 240, "new")), ProfileJson = "{}" });
        await db.SaveChangesAsync();
        var context = new AiToolContext("kj", "kg", today);
        var result = await new GetDailySummaryTool(db).ExecuteAsync(
            AiToolArgs.Parse(JsonSerializer.Serialize(new { date = historical.ToString("yyyy-MM-dd") })), context, default);
        var day = JsonSerializer.SerializeToElement(result.Data).GetProperty("days")[0];
        Assert.Equal("complete", day.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, day.GetProperty("protein").ValueKind);
        Assert.Equal(Math.Round(1800 * 4.184), day.GetProperty("calories").GetDouble());
        Assert.Equal(Math.Round(2200 * 4.184), day.GetProperty("targets").GetProperty("calories").GetDouble());
        var foodLog = await new GetFoodLogTool(db).ExecuteAsync(
            AiToolArgs.Parse(JsonSerializer.Serialize(new { date = historical.ToString("yyyy-MM-dd") })), context, default);
        Assert.True(JsonSerializer.SerializeToElement(foodLog.Data).GetProperty("archived").GetBoolean());
    }

    private static async Task<(Microsoft.Data.Sqlite.SqliteConnection Connection, AppDb Db)> CreateAsync()
    {
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var db = new AppDb(new DbContextOptionsBuilder<AppDb>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        var user = await TestUsers.CreateAsync(db, "ask-ai-review");
        db.CurrentUser = user.Id;
        return (connection, db);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("{\"actions\":[null]}")]
    [InlineData("{\"actions\":[{\"type\":123,\"payload\":{}}]}")]
    [InlineData("{\"actions\":[{\"type\":\"openFoodLog\",\"payload\":[] }]}")]
    public async Task MalformedProposalsAreRejectedWithoutThrowing(string arguments)
    {
        var proposer = new AiActionProposer(new AiToolContext("kcal", "kg", new DateOnly(2026, 9, 30)));
        await proposer.ProposeAsync(arguments, CancellationToken.None);
        Assert.Empty(proposer.Accepted);
    }

    [Fact]
    public async Task StaleTurnCannotOverwriteCompletedConversation()
    {
        var (connection, db) = await CreateAsync();
        await using var connectionLifetime = connection;
        await using var dbLifetime = db;
        var firstMemory = new AiConversationMemoryService(db);
        var request = new AiChatRequest("Show my recent history", null, ClientTurnId: "first");
        var first = await firstMemory.PrepareAsync(request, CancellationToken.None);
        await using var other = new AppDb(new DbContextOptionsBuilder<AppDb>()
            .UseSqlite(db.Database.GetDbConnection()).Options) { CurrentUser = db.CurrentUser };
        var otherMemory = new AiConversationMemoryService(other);
        var second = await otherMemory.PrepareAsync(request with { ClientTurnId = "second" }, CancellationToken.None);
        Assert.NotNull(await firstMemory.CompleteAsync(first, request.Message, new AiChatResponse("winner", []), CancellationToken.None));
        Assert.Null(await otherMemory.CompleteAsync(second, request.Message, new AiChatResponse("stale", []), CancellationToken.None));
        other.ChangeTracker.Clear();
        var snapshot = await otherMemory.GetActiveAsync();
        Assert.Equal(1, snapshot.ConversationVersion);
        Assert.Equal("winner", snapshot.Messages.Last().Content);
    }

    [Fact]
    public async Task UsageUpdatesDoNotLosePendingConversationTracking()
    {
        var (connection, db) = await CreateAsync();
        await using var connectionLifetime = connection;
        await using var dbLifetime = db;
        var memory = new AiConversationMemoryService(db);
        var request = new AiChatRequest("Show my recent history", null, ClientTurnId: "pending");
        var prepared = await memory.PrepareAsync(request, CancellationToken.None);
        var meter = new AiChatUsageMeter(db, NullLogger<AiChatUsageMeter>.Instance);
        await meter.RecordAsync(new AiTokenUsage(500, 200, 100, 20), 2, CancellationToken.None);
        await meter.RecordAsync(new AiTokenUsage(300, 100, 50, 10), 1, CancellationToken.None);
        Assert.NotNull(await memory.CompleteAsync(prepared, request.Message, new AiChatResponse("done", []), CancellationToken.None));
        db.ChangeTracker.Clear();
        var usage = await db.Usage.SingleAsync();
        Assert.Equal(800, usage.ChatInputTokens);
        Assert.Equal(150, usage.ChatOutputTokens);
        Assert.Equal(2, usage.ChatCalls);
        Assert.False(await meter.HasBudgetAsync(950, CancellationToken.None));
        Assert.True(await meter.HasBudgetAsync(951, CancellationToken.None));
    }

    [Fact]
    public async Task OversizedResultDoesNotGrantEvidenceForHiddenRecords()
    {
        var context = new AiToolContext("kcal", "kg", new DateOnly(2026, 9, 30), new AiTurnBudget(maxCharactersPerResult: 100));
        var registry = new AiToolRegistry([new OversizedTool()]);
        var executor = new AiToolExecutor(registry, NullLogger<AiToolExecutor>.Instance);
        var result = await executor.ExecuteAsync(new AiFunctionCall("call", "oversized", "{}"), context, CancellationToken.None);
        Assert.False(result.Succeeded);
        Assert.False(context.Evidence.Contains("record", "hidden"));
    }

    private sealed class OversizedTool : IAiTool
    {
        public string Name => "oversized";
        public string Description => "Test";
        public System.Text.Json.Nodes.JsonObject ParametersSchema => new() { ["type"] = "object" };
        public string ProgressLabel(AiToolArgs args) => "Checking";
        public Task<AiToolResult> ExecuteAsync(AiToolArgs args, AiToolContext context, CancellationToken ct)
        {
            context.Evidence.Record("record", "hidden");
            return Task.FromResult(AiToolResult.Of(new { text = new string('x', 1000) }));
        }
    }
}
