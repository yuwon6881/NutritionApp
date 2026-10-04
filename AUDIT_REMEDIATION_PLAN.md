# NutritionApp audit remediation plan

Source: external (Gemini) audit, verified against the working tree on 2026-10-05. Each item below was
reproduced by reading the current code; severities are re-rated after verification. Every behavior change
starts with a failing regression test (repo rule for sync, auth, and coaching math).

## Verdict summary

| # | Finding | Verdict | Re-rated |
|---|---------|---------|----------|
| 2.1 | Trajectory rebuilt before pending writes are flushed | **Confirmed** | P1 |
| 2.6 | `project()` crashes on a delete for a record not in local state | **Confirmed**, worse than reported | P1 |
| 2.2 | In-flight Google Health create loses its resource name | **Partly true**: only *delete* during an in-flight create; result is an orphaned remote record, not a duplicate | P2 |
| 2.7 | 401 drain loop without sign-in prompt | **Confirmed** (1 request / 10 s while visible) | P2 |
| 2.4 | Intake-step detection lacks lookback history | **Confirmed** | P2 |
| 2.3 | Coded food results share one provider-wide frequency | **Confirmed** | P2 |
| 2.5 | Adaptive proposal explanation says "Holding the accepted estimate" | **Confirmed** | P2 |
| 3.1 | KMS decrypt + OAuth refresh per outbound record | **Confirmed** | P2 |
| 4.5 | `FoodPicker` row is `role="button"` wrapping a nested `Button` | **Confirmed** (nested-interactive a11y defect) | P2 |
| 2.9 | Unguarded `FindSystemTimeZoneById` | Valid hardening only; profile zones are validated on write | P3 |
| 3.2 | Retention compaction N+1 | Valid; only matters on a catch-up run | P3 |
| 3.3 | Sequential bulk `store.mutate` | Valid but minor; drain already coalesces | P3 |
| 3.4 | `WeightChart` geometry not memoized | Overstated: scrub only re-renders when the index changes; no React Compiler | P3, measure first |
| 2.8 | 409 drops a mutation whose response was lost | **False**: `SyncService.Apply` returns the stored `MutationReceipt` revision for a retried op id before any revision check | — |
| 3.5 | Covering index for trajectory reads | **Not worth it**: `(UserId, Date)` index exists; per-user 90-day window is tiny (`Auth:MaxUsers` = 1) | — |
| 3.6 | Unbounded `ExchangeGates` | **Not a leak in practice**: keys are user × peer × scope, bounded by the user cap | — |
| 4.1 | Untracked `CrossAppAiSummaryCoverage` migration | Not a defect: part of the in-progress cross-app AI change set; commit it with that work | — |
| 4.2 | Rate-limit partition misses bearer users | **Moot**: `/api/integrations/v1/*` endpoints have no rate-limit policy, so `AccountOrIpKey` never runs for them | — |
| 4.3 / 4.4 | Deduplicate sync services; split oversized files | Valid debt, out of scope for bug fixes; do not grow these files further | Deferred |

## Phase 1 — data correctness (P1)

### 1. Flush pending writes before trajectory rebuild (2.1)

`SyncService.Apply` (`api/Services/SyncService.cs:178`) and `GoogleHealthWeightImportService.WriteAsync`
(`:105`) call `RebuildFromUnderLock` while the new/edited/deleted entry or weight is still only in the
change tracker. `LoadDays` (GroupBy/Sum) and the weights query hit the database, so the rebuild misses the
change and the result is stamped with the new `TrajectoryRevision`, which then reads as current.

- Test first (`tests/CoachingPersistenceTests.cs` or a new `TrajectorySyncTests.cs`): apply an entry
  mutation and an import of a weight via each path; assert the stored `DailyExpenditureEstimate` rows equal a
  fresh `RebuildFrom` over the same data. Cover add, edit (calories change), and delete.
- Fix: `await db.SaveChangesAsync(ct)` immediately before each `RebuildFromUnderLock` call. Both run inside
  the `MutationLock` transaction, so a later failure still rolls back (precedent: `RemoveImportedWeightOn`
  already flushes mid-transaction). The receipt is still added and saved by the final `SaveChangesAsync`.
- Consider moving the flush into `RebuildFromUnderLock` itself so no future caller can repeat the mistake
  (`EnsureThroughTodayUnderLock` and `RebuildFrom` are harmless either way).
- Existing accounts: bump `ExpenditureTrajectory.AlgorithmVersion` (or the source revision) so stored windows
  rebuild once on next read; otherwise stale points persist until a mutation touches an earlier date.

### 2. Projection must not invent records (2.6)

`project()` (`web/src/lib/projection.ts:46`) pushes `{id, revision, deleted:true}` with no `date`/`name`
when a queued delete targets a record absent from the projected state, then sorts with
`a.date.localeCompare` (or `a.name` for foods) and throws. This is reachable in normal use: `historyState`
(`web/src/lib/history.ts`) projects the *whole* queue onto an older window, so deleting today's entry while a
past month is open crashes the history render; a delete for a record removed by another device does the same
in the main view.

- Test first (`projection.test.ts`): delete of an absent entry, weight, and food leaves the arrays unchanged
  and does not throw; a history-window projection with a queued delete outside the window renders.
- Fix: `if(i<0&&op.delete)continue;` before copying. Also skip non-delete ops whose `date` falls outside a
  dated state's `start`/`end` so edits do not leak into other history windows (`clipHistory` already trims,
  but only after sorting).

## Phase 2 — sync and session behavior (P2)

### 3. Delete during an in-flight Google Health create (2.2)

Verified path: `QueueMutationAsync` with `operation.Delete && !mapped` calls `CancelWork`, which clears
`LeaseId` and `GoogleOperationName`. When the create returns, `FinalizeAsync` sees a foreign lease and drops
`result.ResourceName`; the remote reading is never deleted. Edits during a create are already safe (lease
kept; `FinalizeAsync` re-queues because `DesiredRevision` changed). Same code in the weight, nutrition, and
body-fat services.

- Test first per service: lease a create, queue a delete, finalize the create with a resource name; expect
  the work to end `pending` with the resource name and then issue `DeleteAsync`. Repeat for
  `awaiting_operation` (create accepted, operation not yet polled).
- Fix: when the work is `processing` with a live lease, or `awaiting_operation` with an operation name, a
  delete records `DesiredDeleted`/`DesiredRevision` only and does not cancel. In the success finalizer, when the
  finished request was a create/poll but the work now desires deletion, transition to `pending` even if
  `DesiredRevision` equals the lease revision (the poll lease can carry the delete revision already).
- Expired `processing` leases keep today's behavior (they become `unknown`).

### 4. Session expiry stops the drain and asks for sign-in (2.7)

On 401 from `/sync`, `drain()` rethrows, the queue stays, and the 10 s heartbeat retries forever; the user
only sees a banner. `App.tsx` already signs out on a 401 from `/auth/me`, but that check does not run while
the queue is non-empty.

- Test first (`useNutritionStore` / drain tests): a 401 stops further `/sync` calls, keeps the queue intact,
  and raises a session-expired signal.
- Fix: classify 401 in `drain()` as auth-expired: stop draining, suspend heartbeat-driven drains, and notify
  the shell (callback or event) so it shows sign-in. Signing back in to the same account resumes the retained
  queue. Must not discard queued work (repo invariant). Confirm queue storage survives `setUser(null)` for the
  same account and is not replayed into a different account.

### 5. Load enough history for intake-step detection (2.4)

`IntakeStep.Largest` scans from `start-6` with a 7-day "before" block, so it needs logged days back to
`today-41`. `CoachingService.PreviewCore` loads from `today-28` and `ExpenditureTrajectoryService` loads
`start-28`, so steps at roughly `today-34 … today-25` are invisible and their water/glycogen shift is read as
tissue change.

- Test first (`tests/` domain or service test): a sustained 400 kcal/day step at `today-30` with 4+ logged
  days on each side produces the settled-window estimate via the service, not just via the pure domain call.
- Fix: one constant, e.g. `Expenditure.HistoryDays = WindowDays + IntakeStep.SettleDays - 1 + 7` (= 41),
  used by both loaders for diary days. `EstimateWindow` already filters to its own window, so extra days only
  feed detection. Check other consumers of `days` in `Coach.Calculate` for window assumptions.
- Bump `ExpenditureTrajectory.AlgorithmVersion` so stored points recompute.

### 6. Per-food frequency for coded results (2.3)

`FoodRanking.UsageKey` maps every coded result to `"code:"+Source` and `UsageCounts` gives it the provider-wide
count, so frequency never separates two Open Food Facts products. `DiaryEntry` stores no code.

- Test first (`FoodSearchPersonalizationTests`): repeat the existing ranking test with `Code` set on each
  result; the frequently logged product must rank first.
- Fix: use `NameUsageKey(Source, Name)` for all results and delete the `sourceCounts` query (one fewer query
  per search). Update the doc comment. Persisting a code on entries is a larger change and not needed now.

### 7. Adaptive explanation contradicts the target (2.5)

With a trajectory point, `PreviewCore` calls `Coach.Calculate(allowAdaptation:false, adaptiveOverride:true)`;
`Expenditure.EstimateWindow` appends `HoldAccepted`, and `Coach.Calculate` uses `estimate.Reason` because
`adaptive` is true. The preview shows adapted calories with "Holding the accepted estimate until the next
check-in."

- Test first: preview with an adaptive trajectory point has no hold text in `Explanation`.
- Fix: in `Coach.Calculate`, when `adaptiveOverride == true`, use the reason without the hold suffix (expose
  the suffix as an internal constant or return the evidence prefix separately rather than string-replacing in
  two places).

### 8. Reuse Google access tokens within their lifetime (3.1)

`GetAccessTokenAsync` decrypts the refresh token with KMS and calls Google's token endpoint for every record;
three queues run in parallel, so a 25-record sweep can spend ~75 KMS decrypts and token exchanges.

- Test first: processing two records for one user performs one decrypt and one token exchange.
- Fix: cache the access token in-process keyed by `userId + ConnectionGeneration` (the token covers all
  granted scopes; keep the scope check against the connection), with TTL = `expires_in` minus a safety margin.
  Evict on `MarkReconnectRequiredAsync`, revoke/disconnect, and generation change; drop the entry on a 401 from
  Google before retrying. Mirror `IntegrationTokenService`'s size-limited `MemoryCache` and per-key gate.

### 9. FoodPicker row semantics (4.5)

The result row is a `div role="button"` with a custom key handler that contains the star `Button`: nested
interactive controls, and the `aria-label` hides the nutrition summary from screen readers.

- Fix: row becomes a container with two sibling controls: the choose action built on the `Button` primitive
  (or a row variant added to it) carrying the name and summary as its content, and the existing star button.
  Remove the custom key handler. Keep the 44 px compact target and current visuals.
- Verify: `check:standards`, unit tests for keyboard activation, and `test:visual` in a real browser.

## Phase 3 — optional hardening (P3)

- 2.9: add `ZoneResolver.Today(profile)` with `TryFindSystemTimeZoneById` and an explicit fallback; replace
  the four direct calls (`RetentionService`, `CoachingService`, `ExpenditureTrajectoryService`,
  `NutritionNotificationDispatch:57`). Log the fallback rather than hiding it.
- 3.2: in `CompactUser`, load `Days` and `Entries` for the batch of dates in two queries, save once, and
  delete with one `ExecuteDeleteAsync` over the date set. Keep the 120-date batch limit.
- 3.3: add `mutateMany` that enqueues several ops in one `commit` (one IndexedDB write, one projection) and
  use it in `FoodDiary` bulk move/paste and `CopyDayDialog`. Also makes a bulk action all-or-nothing locally.
- 3.4: only if a browser profile shows scrub jank, memoize `WeightChart` geometry with `useMemo`.

## Not planned

2.8, 3.5, 3.6, 4.1, 4.2 per the summary table. 4.3 (shared sync base class) and 4.4 (file splits) are real
debt; schedule separately. Item 3 must land in all three sync services regardless, which is the strongest
argument for 4.3 afterwards.

## Verification per phase

```powershell
cd D:\App\NutritionApp
dotnet test tests/Nutrition.Tests.csproj
cd web
npm.cmd run typecheck
npm.cmd test
npm.cmd run check:standards
npm.cmd run build
npm.cmd run test:visual   # item 9 and any layout change
```
