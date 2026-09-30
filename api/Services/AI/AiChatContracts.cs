namespace Nutrition.Api.Services.AI;

// What one Ask AI turn hands the next, persisted by the server-owned conversation.
public sealed record AiConversationState(
    string? LastFoodLogDate = null,
    IReadOnlyList<string>? LastFoodIds = null,
    string? LastCoachingPlanId = null);

public sealed record AiInvocationContext(
    string Surface,
    string? Preset = null,
    string? Date = null,
    string? FoodId = null);

public sealed record AiChatMessage(string Role, string Content);

public sealed record AiChatRequest(
    string Message,
    IReadOnlyList<AiChatMessage>? History,
    AiConversationState? State = null,
    Guid? ConversationId = null,
    int? ConversationVersion = null,
    string? ClientTurnId = null,
    AiInvocationContext? Context = null);

public sealed record AiChatResponse(
    string Reply,
    IReadOnlyList<AiUiAction> Actions,
    bool CloseChat = false,
    AiConversationState? State = null,
    Guid? ConversationId = null,
    int? ConversationVersion = null,
    bool HistoryRedacted = false,
    AiActionBatchResponse? ActionBatch = null);

public sealed record AiUiAction(string Type, Dictionary<string, object?> Payload, Guid? ActionId = null);

public sealed record AiActionBatchResponse(
    Guid BatchId,
    IReadOnlyList<AiUiAction> Actions,
    string Status = "PendingReview");

public sealed record AiConversationResponse(
    Guid? ConversationId,
    int ConversationVersion,
    IReadOnlyList<AiChatMessage> Messages,
    AiConversationState? State,
    bool HistoryRedacted = false,
    IReadOnlyList<AiActionBatchResponse>? PendingActionBatches = null);

public sealed record AiChatOutcome(
    AiChatResponse Response,
    bool IsProviderError,
    bool IsConflict = false,
    IReadOnlyList<Agent.AiToolTrace>? ToolTrace = null);
