# External performance review — triage and plan (2026-10-07)

Source: a third-party (Gemini) scaling review of `api/` and `web/src/`. I checked every claim against the current worktree. See **Implementation status** below for what has shipped.

## Implementation status (2026-10-07)

Items 1–8 are implemented, each behind a regression test written first:

1. `GoogleHealthSyncStatus` counts and picks the latest problem in SQL for all four status reads. Compaction prunes succeeded or cancelled nutrition rows whose entries it removed. No index was added.
2. `lib/retainedReload.ts` reads only the `mutations` or `drafts` partition before dispatch, and reloads the full snapshot only when that partition differs from memory.
3. `WeightHistory.Compute` reads a 372-day warm-up. A caller reports the earliest trend point it read, and the loader falls back to the full history when that point sits inside the warm-up. The 10-year equivalence test (`tests/WeightHistoryTests.cs`) fails if the warm-up is shortened to 20 days.
4. `Preview` uses the lock-free trajectory check and reads the latest estimate without the lock. Accept and Decline still recompute under it.
5. Energy loads only the plan in effect at the period start plus the plans inside it. The earliest date uses four `MinAsync` calls.
6. FoodWeekStrip calls `projectedDayIntakes`, which projects each stored snapshot once per render.
7. Decision (b): the write-only `diary_days` store is removed as a full slice. Database version 6 deletes it, and the V1 migration no longer copies history into it.
8. All bullets are done. `mergeRetained` keeps its content comparison but no longer serializes drafts.

Not measured: the paired Pixel 7 benchmark (items 2 and 6) and production query plans.

Context that changes the weighting:

- Production runs one account (`Auth:MaxUsers=1`, one Cloud Run instance). A cost that grows "across tenants" is negligible. What matters is cost that grows with **account age**.
- Meal detail is compacted after 90 days (`Retention:MealDetailDays`). `DiaryEntry` rows are bounded, but `Weight`, `DayStatus`, `AcceptedPlan`, and sync-work rows are not.
- The client holds a window, not the full history. Bootstrap sends 90 days of entries, weights, and days, plus 56 days of trend seed, and `plans`/`checkIns`/`phaseDecisions` are capped at 12. Year views load at most one year. Several frontend claims assumed multi-year arrays on the client, and that assumption is false.
- The web app has no React Compiler, so render-path memoization is manual.

## Worth implementing (ranked)

### 1. Google Health sync status: aggregate in SQL; prune dead nutrition mappings
- **Verified.** `GoogleHealthService.AttachSyncStatusesAsync` (`api/Services/GoogleHealthService.cs:520-535`) and each `Get*StatusAsync` (Weight `:187`, Nutrition `:222`, BodyFat `:194`) load every sync-work row (tracked) only to count the pending ones and pick the latest failed/unknown one. This runs on every sync, status read, and AI steps call, including cache hits.
- **Verified, with a correction.** A succeeded row is the **local→Google mapping** (`GoogleResourceName`) used to mirror later edits and deletes. Gemini's "delete succeeded rows" would break that mirroring. The real leak is narrower: `RetentionService.CompactUser` hard-deletes entries older than 90 days (`RetentionService.cs:40`), and their `GoogleHealthNutritionSyncWork` rows stay forever. Those entries are read-only, so the mapping can never be used again. That is roughly 2–4k rows a year, and step one loads all of them.
- **Plan:**
  1. Write tests first: the status output (state, pending count, latest problem's category and message) is identical between the current and new paths for pending, failed, unknown, and disabled fixtures.
  2. Replace the `ToListAsync` calls with `CountAsync` over the claimable states, plus one `OrderByDescending(UpdatedAt).FirstOrDefaultAsync` over `failed|unknown`, all `AsNoTracking`. Use one shared helper for all four call sites (no near-duplicates).
  3. In `CompactUser`, in the same transaction as the entry deletion, delete only `succeeded`/`cancelled` nutrition rows whose `EntryId` no longer exists. Never delete `pending`, `processing`, `awaiting_operation`, `failed`, or `unknown` rows. Unknown outcomes need explicit recovery.
  4. Add a regression test: compaction removes only terminal orphan rows. An edit to a live entry still finds its mapping.
  5. Consider an index on `(UserId, ProcessingState)` only if the query plan needs it. The existing `(ProcessingState, NextAttemptAt)` index does not lead with `UserId`.

### 2. Client wake path: stop the full IndexedDB reload and app-wide re-render every 30 s
- **Verified.** Every visible wake (heartbeat every 30 s, or every 10 s while work is retained; focus; online) runs `drain()` (`web/src/useNutritionStore.ts:242-252`) and `runPendingDrafts()` (`:357-368`). Each one calls `readLocal(user)`, which reads `accounts`, `mutations`, `drafts` (base64 photos), and `saved_foods`, and then calls `setLocal(durable)` with new object identities. That reloads everything twice and re-renders the whole tree, even when the queue and drafts are empty.
- **Plan:**
  1. Lock down the cross-tab and retained-work behavior with tests first. Work queued by another tab is picked up on wake even if its broadcast was missed. Nothing is dropped.
  2. Reload only the `mutations` and `drafts` partitions before dispatch (the only ones dispatch consumes). Read `accounts` and `saved_foods` only when the persisted revision is newer than the in-memory one.
  3. Skip `setLocal` when the reloaded queue and drafts match the in-memory copy (compare ids and versions, not content), so idle wakes cause no re-render.
  4. Re-run the paired mobile benchmark (`web/artifacts/performance/`) and compare long tasks and idle frame drops.

### 3. Server trend reads: bounded warm-up lookback instead of full weight history
- **Verified.** These paths load every weigh-in ever recorded:
  - `ProgressSummaryService.BuildWeightSummary` (`:114`) for every period
  - `TrainingContextService.Build` (`:63`)
  - `NutritionPeerSummaryService.Get` (`:22`), which loads it a second time right after `context.Get`
  - `BodyRecordService.Capture` (`:60`)
  - `CoachingService.CompleteGoal` (`:206`)
- **Corrections.** `Coach.Trend` steps per weigh-in, not per day, so the work is O(W), not O(days since sign-up). `CoachingService.Preview` is already bounded (`since − 56`). The trajectory rebuild loads at most about 210 days, so its 90 × `CleanTrend` calls are cheap.
- **Why it's safe.** The EMA's dependence on the seed falls as 0.5^(days/7). After 365 days that is about 2e-16, below double precision. The Hampel and context windows reach at most 7 days. A 365-day warm-up (more for `period=all`, which genuinely needs every row) is numerically identical.
- **Decision for you.** `PERFORMANCE_IMPLEMENTATION_FINDINGS.md` says the app "preserves full-history trend mathematics". This change keeps the results but not the literal full read.
- **Plan:**
  1. Write tests first on a 10-year fixture. Full-history and bounded outputs agree within 1e-9 kg for trend, `ObservedLoss`, `GoalPolicy.Evaluate`, and the body capture. Include sparse histories (fewer than 3 weigh-ins inside the window) so `GoalPolicy`'s `points.Length >= 3` freshness gate does not change. If it does, extend the lookback to cover at least the last N weigh-ins.
  2. Add one shared constant (`WeightSignal.TrendWarmupDays`) and apply it at the five sites.
  3. In `NutritionPeerSummaryService`, reuse the weights `TrainingContextService` already loaded.
  4. Optional: make the confirmation scan in `WeightContextPolicy.Resolve` a forward two-pointer. It is O(marked × W) today. That is mostly moot once W is bounded.

### 4. `CoachingService.Preview` takes the account mutation lock on every read
- **Verified.** `Preview` (`CoachingService.cs:17-23`) always opens a transaction and an advisory lock, because `LatestUnderLock` may rebuild the trajectory. It is called by `/api/coaching/preview`, the peer summary, and the AI coaching tool, so reads queue behind sync writes.
- **Plan:**
  1. Write tests first: the preview result is unchanged for complete and stale trajectories, and a concurrent mutation test still serializes the rebuild.
  2. Try `ExpenditureTrajectoryService.TryReadComplete` without the lock first, and take the lock only when the 90-day window is stale. This is the same pattern `EnsureThroughToday` already uses.
  3. Keep accept and decline unchanged, because they must stay under the lock.

### 5. Progress energy summary: load only the plans the window needs
- **Verified.** `BuildEnergySummary` (`ProgressSummaryService.cs:160-171`) loads and JSON-parses every plan with `Date <= end`, even for `week`. That is roughly 52 a year.
- **Corrections.** The day loop uses a moving cursor, so Gemini's "O(D × P) `LastOrDefault`" claim is false. `EarliestRelevantDate` (`:100-108`) is a 4-way `UNION ALL … ORDER BY … LIMIT 1` and runs only for `all` (results cached for 2 min).
- **Plan:**
  1. Write tests first: maintenance carried into the first day of each period is unchanged.
  2. Load the last plan before `start` plus the plans inside `[start, end]`.
  3. Replace the `UNION` with four indexed `MinAsync` calls (each table has a `(UserId, Date)` index).

### 6. `FoodWeekStrip`: project once per render, not once per uncached day
- **Verified.** For each of the 45–56 day buttons, `projectedDayIntake` → `historyState` (`web/src/lib/history.ts:17-25`) runs `project(local.state, queue)` and `clipHistory` again whenever the coordinator has no cached copy of that date.
- **Plan:** Build one `date → intake` map per render from a single projection and test it against the per-day results. `FoodWeekStrip.tsx` currently has **uncommitted local edits**, so wait for or coordinate with that work.

### 7. `diary_days` IndexedDB store is write-only
- **Verified.** `saveDatedDiaryBatch` writes on every day fetch (`diaryCoordinator.ts:99,247,304`; `useNutritionStore.ts:190`). `readDatedDiary` is imported but never called, and `readDatedDiaryRange` has no production caller. The store grows with every browsed day and is never read.
- **Decision for you:**
  - (a) Read it as the cold-start/offline source for past dates before going to the network. That fits "instant dated cached rendering", and needs offline tests.
  - (b) Remove the writes, the store, and its wipe handling as a full vertical slice.
- I recommend (a) only if offline viewing of past days is a promised behavior. Otherwise (b).

### 8. Small, low-risk cleanups (one batch, optional)
- `MissedDays`: `missingDays` runs unmemoized at the app root (`components/MissedDays.tsx:14`) and does `days.find` and `entries.some` per date. It is bounded by the 90-day window, so this is minor. Memoize it, use `Map`/`Set` lookups, and resolve dates with `mutateMany` instead of sequential `mutate` (`:25-74`).
- `LogFoodSavedFoods`: `isRecipe` JSON-parses each food up to 3× per render (`:53-75`). Compute a recipe id set once per food list.
- `WeightChart`: up to 400 dots (the server caps the series via `ReduceWeightSeries`) re-render on every scrub move. Memoize the dots layer so only the selected marker changes. This needs a visual test.
- `NutritionNotificationService.SetSettingsAsync` → `ArmWakesAsync` scans all users' preferences. On a settings save, arm only the saving user's next instant and leave the global repair to dispatch and maintenance.
- `SyncService` food upsert runs a synchronous `db.Foods.Any(...)` inside the validation delegate (`:111`). Make it async. The column **is** indexed (`(UserId, Barcode, Deleted)`).
- `mergeRetained` (`lib/retainedMerge.ts:10`) runs `JSON.stringify` on multi-MB base64 photo drafts. Compare `versionId`/`mutationId` and reference identity for drafts instead.
- Add `AsNoTracking` to the `/api/state` reads of weights, plans, check-ins, and phase decisions (`RecordEndpoints.cs:123,142-147`).

## Not worth addressing, or not accurate

| Claim | Finding |
| --- | --- |
| `Coach.Trend` steps day by day | False. It is one step per weigh-in. |
| Energy loop O(D × P) `LastOrDefault` | False. The loop uses a cursor. |
| Preview loads unbounded weights | False. It loads 84 days. |
| Trajectory rebuild: 180 × `CleanTrend` over full history | The call count is right, but weights are capped at about 210 days, so the cost is negligible. |
| Barcode not indexed | False. A `(UserId, Barcode, Deleted)` index exists. |
| `SyncReceipt` index missing | No such entity. `MutationReceipt` is keyed `(UserId, Id)`. |
| `/api/foods` `Take(1000)` includes deleted rows | False. It filters `!Deleted`. The cap matches the server-enforced 1,000-food library limit. |
| Quota check bypasses cache, cross-tenant scan sum | Intentional (commented: quota must read current counters). Scans with an `ObjectPath` are temporary (under 24 h), and there is one tenant. |
| Cross-tenant Cloud Tasks loop | True in form, but with one user it is one call. A cheap fix is in item 8. |
| `FoodRanking.UsageCounts` scans full history | Entries are retained for 90 days, so the scan is bounded. |
| Export materializes everything | Rate-limited (5 per 5 min). Entries are bounded and the payload is small for one user. |
| Legacy photo-set migration on every page read | True, but cheap (indexed, a handful of photos). Retire it later once production shows no legacy sets. |
| `RepairProvable` N+1 | Runs only for orphan rows, normally zero. Body saves are rare. |
| Revision/ScanJob/sync composite indexes | Per-user row counts are in the hundreds, or the tables are temporary. |
| Client holds full-history arrays | False. The client holds a 90-day window plus a 56-day seed, with plans capped at 12. `acceptedTargetIntervals` is lifetime but about 52 a year. |
| `local.history` snapshots grow and are re-acknowledged | Nothing current writes `local.history`. Only legacy migration and readers touch it. |
| `project()` sorts everything unconditionally | False. Copy-on-write sorts only touched collections, and an empty queue returns early. |
| `canonicalState` O(D²) | False. The canonical set is the 1–2 acknowledged rows. |
| Client `countedWeighIns` O(W²) per keystroke | Client W is about 146 or fewer. Today and StepCalorieCalculator are already memoized. |
| `calendarTarget` JSON.parse per button | Only for dates outside the intervals (for example tomorrow), and there are at most 12 plans. |
| Habit calendars build multi-year grids | False. They use the state window (about 90 days) and are memoized. |
| `FoodPicker`/`findSavedFood` O(R × F) | R ≤ about 20. Negligible. |
| Unvirtualized lists | Saved foods are capped at 1,000, body records are paged 20 at a time, goal history has 12 or fewer. Revisit only if measured. |
| `DiaryCoordinator` in-memory map, `localDataRemoval` cursors | Bounded to one session, or runs only on wipe and sign-out. |

## Verification for each implemented item

- **Backend:** `dotnet test tests/Nutrition.Tests.csproj`, with the new regression tests written before each behavior change (auth, sync, and coaching rules).
- **Frontend:** from `web/`, run `npm.cmd run check:docs`, `check:standards`, `typecheck`, `npm.cmd test`, and `build`.
- **UI items (2, 6, 8 chart/MissedDays):** also run `npm.cmd run test:visual`.
- **Items 2 and 6:** re-run the paired Pixel 7 / 4× CPU benchmark and report before and after numbers. Production query plans and deployed latency remain unverified unless measured separately.
