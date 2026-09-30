# Ask AI architecture

Ask AI is a read-only assistant with reviewable screen-opening proposals. It does not save food, weights, plans, or account settings. The existing screen and its normal validation remain responsible for every user-confirmed change.

## Request flow

`AiChatEndpoints` → `AiAssistantService` → `AiConversationMemoryService` / `AiBaselineSnapshotBuilder` → `AiAgentEngine` → `AiChatClient` and registered tools.

- The authenticated API owns one active conversation per account. Client history/state are replaced with server memory; `clientTurnId` identifies a retry and conversation ID/version protect against stale devices. EF treats `Version` as a concurrency token. A pending duplicate is a conflict, not a completed reply.
- Closing the panel preserves the conversation. New chat clears local state only after the server confirms deletion. Failed requests retain retry input and identity. Streaming `done` is authoritative and replaces provisional text.
- Baseline context is compact profile metadata plus the same daily-summary tool used by the engine. Additional facts come from read-only tools, never from another preloaded calculation path.
- Tool definitions live in `api/Services/AI/Tools`; registration is explicit. `AiToolExecutor` validates arguments, caches within the request, bounds results, and publishes evidence only after a successful result is delivered. Returned names, notes, and other tool text are data, not instructions.
- `AiActionProposer` validates the allowlist, typed payloads, and current-turn evidence. Food IDs and prefilled food names must have been surfaced by a tool. At most one action is accepted per turn. The panel waits for an explicit Open or Dismiss; Open uses the existing diary, food search, weight entry, coaching, expenditure, or barcode flow.

## Nutrition semantics

Daily summaries and food logs preserve archived day totals, unknown nutrients, and explicit logging-day status. Targets use the effective plan for each date, including weekday calories and macro scaling; a newer plan does not rewrite historical targets. Calories convert to the account's kcal/kJ preference. Food search labels the nutrient basis honestly rather than treating every serving as 100 g. Expenditure is identified as an estimate. Dates follow the profile timezone.

Canonical coaching/expenditure reads may refresh their derived estimate cache, and food lookup may refresh its public-product cache. These are existing read-service behaviors; no tool accepts a plan or edits diary, weight, or profile records.

## Bounds, accounting, and retention

- One turn permits four tool rounds plus a final answer, eight read-tool calls, 12,000 characters per tool result, and 40,000 tool-result characters overall. Prompt history is bounded independently.
- Each successful provider response atomically increments UTC daily chat usage, including responses preceding a later failed round. `Ai:ChatDailyTokenLimit` defaults to 100,000 input + output tokens and is checked before each provider call. This is an admission guard: an in-flight response or concurrent turns can cross the threshold. It is not a strict prepaid spending cap.
- Provider calls use the Responses API with `store: false`; encrypted reasoning items remain within the current tool loop. Chat model selection uses `OpenAi:Models:Chat`, then existing model fallbacks. Server configuration owns API credentials.
- Existing scheduled storage cleanup prunes completed turns older than `Retention:AiTurnRetentionDays` (default 90) and abandoned pending turns after ten minutes. A conversation survives panel closure; retained historical turns are finite. Usage retains its existing scheduled sweep. `AskAiReviewSafety` adds indexed cleanup dates and records concurrency metadata; migrations must run through normal deployment.

## Verification

`tests/AskAiTests.cs`, `AskAiReviewTests.cs`, and `AskAiEngineTests.cs` cover persistence/replay, stale writers, malformed and unsupported proposals, delivered evidence, archive/target/unit semantics, retention, accounting, provider failure, and round limits using local fake providers. `web/e2e/ask-ai.spec.ts` exercises responsive themes, keyboard/hit-testing, saved chat, failed reset, authoritative streamed replies, and manual action review.

Run the repository's full backend and frontend unit gates, build/budget checks, standards/docs checks, and browser gates. Local fake-provider and browser results do not establish live model answer quality, production configuration, Cloud Scheduler execution, physical Android behavior, or deployment/migration success.
