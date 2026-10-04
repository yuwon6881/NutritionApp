using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nutrition.Api.Data;
using Nutrition.Api.Services.AI.Agent;
using Nutrition.Api.Services.AI.Tools;

namespace Nutrition.Api.Services.AI;

public sealed class AiAssistantService
{
    private const int MaxMessageLength = 2000;
    private static readonly Regex GreetingPattern = new(@"^\s*(hi|hello|hey|greetings|good\s+(morning|afternoon|evening))\s*[\.!\?]*\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex ThanksPattern = new(@"^\s*(thanks|thank\s+you|thx)\s*[\.!\?]*\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex WhoAreYouPattern = new(@"^\s*(who\s+are\s+you|what\s+can\s+you\s+do|help)\s*[\.!\?]*\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private readonly TimeProvider _timeProvider;
    private readonly AiChatClient _client;
    private readonly AppDb _db;
    private readonly AiAgentServices _agent;
    private readonly AiConversationMemoryService _conversationMemory;
    private readonly ILogger<AiAssistantService> _logger;

    public AiAssistantService(
        AiChatClient client,
        AppDb db,
        AiAgentServices agent,
        AiConversationMemoryService conversationMemory,
        ILogger<AiAssistantService> logger,
        TimeProvider? timeProvider = null)
    {
        _timeProvider = timeProvider ?? TimeProvider.System;
        _client = client;
        _db = db;
        _agent = agent;
        _conversationMemory = conversationMemory;
        _logger = logger;
    }

    public Task<AiChatOutcome> ChatAsync(AiChatRequest request, CancellationToken cancellationToken = default) =>
        ChatAsync(request, sink: null, cancellationToken);

    public async Task<AiChatOutcome> ChatAsync(
        AiChatRequest request,
        IAiAgentProgressSink? sink,
        CancellationToken cancellationToken = default)
    {
        var message = (request.Message ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(message))
            return Ok(new AiChatResponse("Please ask a question about your diet, meals, calories, macros, or weight trend.", []));
        if (message.Length > MaxMessageLength)
            return Ok(new AiChatResponse("That message is too long. Please shorten it and try again.", []));

        if (string.IsNullOrWhiteSpace(request.ClientTurnId))
            return new AiChatOutcome(new AiChatResponse("A client turn ID is required. Reload the conversation and retry.", []), false, IsConflict: true);

        var prepared = await _conversationMemory.PrepareAsync(request, cancellationToken);
        if (prepared.Replay != null) return Ok(prepared.Replay);
        if (prepared.Conflict || prepared.Conversation == null)
        {
            return new AiChatOutcome(
                new AiChatResponse(
                    "This conversation changed on another device. Reload it and retry your message.",
                    [],
                    ConversationId: prepared.Conversation?.Id,
                    ConversationVersion: prepared.Conversation?.Version),
                IsProviderError: false,
                IsConflict: true);
        }

        var serverRequest = request with
        {
            History = prepared.History,
            State = prepared.State
        };

        using var deadlineTimer = new CancellationTokenSource(TimeSpan.FromSeconds(150), _timeProvider);
        using var turnDeadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, deadlineTimer.Token);
        AiChatOutcome outcome;
        try
        {
            outcome = await ExecuteTurnAsync(serverRequest, sink, turnDeadline.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && turnDeadline.IsCancellationRequested)
        {
            await _conversationMemory.FailAsync(prepared, CancellationToken.None);
            return new AiChatOutcome(new AiChatResponse("AI took too long to finish. Your conversation is retained; retry your message.", [],
                ConversationId: prepared.Conversation.Id, ConversationVersion: prepared.Conversation.Version), IsProviderError: true);
        }
        catch
        {
            await _conversationMemory.FailAsync(prepared, CancellationToken.None);
            throw;
        }

        if (outcome.IsProviderError)
        {
            await _conversationMemory.FailAsync(prepared, cancellationToken);
            return outcome with
            {
                Response = outcome.Response with
                {
                    ConversationId = prepared.Conversation.Id,
                    ConversationVersion = prepared.Conversation.Version
                }
            };
        }

        var completed = await _conversationMemory.CompleteAsync(
            prepared,
            request.Message ?? string.Empty,
            outcome.Response,
            cancellationToken,
            outcome.ToolTrace);

        if (completed == null)
        {
            await _conversationMemory.FailAsync(prepared, cancellationToken);
            return new AiChatOutcome(
                new AiChatResponse(
                    "This conversation changed on another device. Reload it and retry your message.",
                    [],
                    ConversationId: prepared.Conversation.Id,
                    ConversationVersion: prepared.Conversation.Version),
                IsProviderError: false,
                IsConflict: true);
        }

        return outcome with { Response = completed };
    }

    private async Task<AiChatOutcome> ExecuteTurnAsync(
        AiChatRequest request,
        IAiAgentProgressSink? sink,
        CancellationToken cancellationToken)
    {
        var message = (request.Message ?? string.Empty).Trim();
        if (TryHandleSmallTalk(message, out var smallTalkReply))
            return Ok(new AiChatResponse(smallTalkReply!, []));

        if (!_client.IsConfigured)
            return Ok(new AiChatResponse("AI chat is not configured on the server.", []));

        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == _db.CurrentUser, cancellationToken);
        var energyUnit = user?.EnergyUnit ?? "kcal";
        var weightUnit = user?.WeightUnit ?? "kg";
        var today = RetentionService.Today(user?.ProfileJson);
        var profile = string.IsNullOrWhiteSpace(user?.ProfileJson) ? null : Nutrition.Api.Services.Json.Read<Nutrition.Api.Domain.Profile>(user.ProfileJson);
        var toolContext = new AiToolContext(energyUnit, weightUnit, today, timeZone: profile?.TimeZone ?? "UTC");

        var proposer = new AiActionProposer(toolContext);
        var snapshot = await _agent.Snapshot.BuildAsync(toolContext, cancellationToken);
        var priorInput = BuildPriorInput(request.History, snapshot, request.Context);
        var seededCalls = BuildSeededCalls(request.Context);

        AiAgentTurnResult turn;
        try
        {
            turn = await _agent.Engine.RunAsync(
                new AiAgentTurnRequest(
                    message,
                    priorInput,
                    toolContext,
                    proposer,
                    seededCalls,
                    Sink: sink),
                cancellationToken);
        }
        catch (AiChatClientException ex)
        {
            return new AiChatOutcome(new AiChatResponse(ex.Message, []), IsProviderError: true);
        }


        var reply = turn.AnyApproximate
            ? EnforceApproximateWording(turn.Reply)
            : turn.Reply;

        var actions = turn.Actions;
        var closeChat = actions.Count > 0 && actions.Any(a => a.Type.StartsWith("open", StringComparison.OrdinalIgnoreCase) && a.Type != "openAddFoodDraft");

        var outgoingState = new AiConversationState(
            LastFoodLogDate: request.Context?.Date ?? request.State?.LastFoodLogDate,
            LastFoodIds: toolContext.Evidence.IdsOf(AiEvidenceLedger.Food).Take(10).ToList() is { Count: > 0 } fids ? fids : request.State?.LastFoodIds,
            LastCoachingPlanId: toolContext.Evidence.IdsOf(AiEvidenceLedger.Coaching).FirstOrDefault() ?? request.State?.LastCoachingPlanId);

        var response = new AiChatResponse(reply, actions, closeChat, outgoingState);
        return new AiChatOutcome(response, IsProviderError: false, ToolTrace: turn.Trace);
    }

    private static List<JsonObject> BuildPriorInput(
        IReadOnlyList<AiChatMessage>? history,
        JsonObject snapshot,
        AiInvocationContext? context)
    {
        var contextNode = new JsonObject
        {
            ["snapshot"] = snapshot
        };
        if (context != null)
        {
            contextNode["openedFrom"] = new JsonObject
            {
                ["surface"] = context.Surface,
                ["preset"] = context.Preset,
                ["date"] = context.Date,
                ["foodId"] = context.FoodId
            };
        }

        var input = new List<JsonObject>();
        if (history != null)
        {
            foreach (var msg in history)
                input.Add(AiInputItems.Message(msg.Role == "assistant" ? "assistant" : "user", msg.Content));
        }

        input.Add(AiInputItems.Message("developer",
            "Current nutrition context (authoritative; past replies may be stale):\n" + contextNode.ToJsonString()));
        return input;
    }

    private static IReadOnlyList<AiSeededToolCall>? BuildSeededCalls(AiInvocationContext? context)
    {
        if (context == null || string.IsNullOrWhiteSpace(context.Preset)) return null;

        return context.Preset switch
        {
            "daily-summary" =>
                [new("get_daily_summary", JsonSerializer.Serialize(new { date = context.Date }))],
            "weight-trend" =>
                [new("get_weight_trend", "{}")],
            "coaching" =>
                [new("get_coaching_recommendation", "{}")],
            _ => null
        };
    }

    private static bool TryHandleSmallTalk(string message, out string? reply)
    {
        reply = null;
        if (GreetingPattern.IsMatch(message))
        {
            reply = "Hello! How can I help with your nutrition and diet today? You can ask about your daily calorie totals, food log, weight trend, or coaching plan.";
            return true;
        }
        if (ThanksPattern.IsMatch(message))
        {
            reply = "You're welcome! Let me know if you have any other nutrition questions.";
            return true;
        }
        if (WhoAreYouPattern.IsMatch(message))
        {
            reply = "I'm your NutritionApp assistant. I can look up your daily nutrition summary, check logged meals, analyze your weight and expenditure trends, and explain your coaching plan.";
            return true;
        }
        return false;
    }

    private static string EnforceApproximateWording(string reply)
    {
        if (reply.Contains("approx", StringComparison.OrdinalIgnoreCase) ||
            reply.Contains("estimate", StringComparison.OrdinalIgnoreCase))
            return reply;
        return reply + "\n\n*(Note: Some calculations are approximate.)*";
    }

    private static AiChatOutcome Ok(AiChatResponse response) => new(response, IsProviderError: false);
}
