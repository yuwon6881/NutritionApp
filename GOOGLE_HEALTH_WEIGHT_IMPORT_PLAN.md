# Google Health weight import plan

Status: implemented 2026-10-01 (phases 1–6) except the items under "Remaining". This plan does not authorize a deployment or OAuth consent-screen change.

## Phase 0 findings (from published API reference, not a live account)

- Reference checks: [list endpoint and scopes](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list), [filter syntax](https://developers.google.com/health/filters), and [data point/source fields](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints). These confirm the documented contract; they do not replace the live-account spike.
- List endpoint: `GET https://health.googleapis.com/v4/users/me/dataTypes/weight/dataPoints` with `pageSize` (max 10000), `pageToken`/`nextPageToken`, and an AIP-160 `filter` such as `weight.sample_time.physical_time >= "…Z" AND weight.sample_time.physical_time < "…Z"`.
- Read scope: `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`. It is requested alongside the existing `.writeonly` scope.
- A point carries `weight.weightGrams`, `weight.sampleTime.physicalTime` (RFC 3339), and `utcOffset` (Duration, for example `"28800s"`). `dataSource.application.googleWebClientId` identifies the writing OAuth client and is the echo filter in addition to mapped resource names.
- Same-date collisions before this change: a second weigh-in for a date already holding a row, deleted or not, violated the unique `(UserId, Date)` index. The API returned 409 and the client dropped the edit with a notice. An imported row (live or deleted) is now replaced by the manual write. Collisions with manual rows and manual tombstones are unchanged.

## Remaining

- Not exercised against a live Google account: response shapes, whether `googleWebClientId` is populated for this app's own uploads, and the scope combination at consent. Run a manual connect, import, and Sync now on a test account before release.
- The read scope must be added to the Google Cloud OAuth consent screen. It is a sensitive health scope and may need Google verification.
- Google's health-data terms on keeping imported data after access is revoked are unchecked (see Decisions).
- Imported weigh-ins reach other screens through the existing revision poll (on wake and every 30 s while visible), not immediately after the sync call.

## Goal

Weigh-ins that a smart scale (Withings, Renpho, Eufy, Fitbit Aria, …) writes to Google Health should appear in NutritionApp without retyping. Today the weight stream is outbound only (`GoogleHealthWeightSyncService`, scope `…health_metrics_and_measurements.writeonly`).

Policy in one sentence: **import fills only days that have never had a NutritionApp weigh-in; anything the user typed, edited, or deleted always wins.**

## Current facts this plan builds on

- `Weight` is one row per `(UserId, Date)` (unique index in `AppDb.cs`, deleted rows included). It has no source/provenance field. Weight tombstones are never purged.
- `SyncService.Apply` is the only weight write path. It takes `MutationLock`, bumps `user.Revision`/`TrajectoryRevision`, rebuilds the expenditure trajectory from the earliest touched date, and calls `GoogleHealthWeightSyncService.QueueMutationAsync`.
- Outbound upload work is created only for a **new** record (`previous is null`). Edits of a record without upload work are never sent. Imported rows written outside `Apply` therefore never echo back to Google.
- Clients learn about server-side changes through `/revisions` (`pollNutritionRevisions` → bootstrap refresh when `account`/`trajectory` revision moves).
- `/api/integrations/google-health/sync` runs while the user is active (app open/foreground, Settings Sync) behind a 2-minute cache and in-flight coalescing. It is the natural trigger; no new polling or scheduler is needed.
- `WeightEntryDialog` targets the existing non-deleted row for a date, so a synced client edits an imported row by its id rather than creating a second one.

## Design

### Day selection and conversion

- Read Google Health weight data points for `today - 30 … today` in the profile time zone (31 days, matching steps).
- Assign each point to a local date using its own `sampleTime.physicalTime` + `utcOffset`; fall back to the profile time zone when the offset is missing.
- If one day has several readings, take the **earliest** (morning weigh-ins are the convention the trend and coaching assume).
- `weightGrams / 1000` → kg; skip points outside the existing `Validation.Number(kg, 20, 400)` range and dates after local today. Skipped points are counted, never coerced.

### Which days are filled

Insert only when **no `Weight` row exists for that date, deleted or not**:

- An existing manual row wins.
- A deleted row (manual or imported) is the user's decision for that day, so it also blocks import. Because weight tombstones are never purged, this needs no separate dismissal table and adds no unbounded bookkeeping.
- Days the app itself uploaded already have a local row, so echoes are skipped by the date rule. As defense in depth, also skip any point whose resource name is a `GoogleHealthWeightSyncWork.GoogleResourceName` and, if the API exposes it, any point whose data origin is this app.

Re-running an import is idempotent: a filled day is no longer empty.

### Provenance

New `Weight` columns (one migration, string constants + check constraint per repo convention):

- `Source`: `manual` (default) | `google_health`.
- `ExternalId`: the Google data point resource name, nullable, for display and support only.

A user edit through `Apply` sets `Source = manual`, because the value is now the user's. `Context` stays `null` on import. The unusual-weigh-in prompt is not raised for imports, so imported spikes are handled by the existing statistical spike filter like any unmarked weigh-in.

### Writing imported rows

New `GoogleHealthWeightImportService` (separate file; `GoogleHealthService.cs` is already ~950 lines):

1. Under `MutationLock` for the user, re-check emptiness for each candidate date (a manual write may have landed during the provider call).
   Re-check the current connection generation, enabled preference, status, and read grant too: disabling import or changing the connection while Google responds must prevent writes from the old consent.
2. Insert all imported rows in one transaction with a single new revision. Bump `user.Revision` and `TrajectoryRevision`, and rebuild the trajectory once from the earliest imported date.
3. Record `WeightImportLastSuccessAt`, the inserted count, and the last failure on the connection.

No `MutationReceipt` is written; the import is not a client mutation.

### Offline collision (must be fixed, not just tested)

A client that has not yet seen an imported row can queue a manual weigh-in for the same date with a new random id. Today that insert would hit the unique `(UserId, Date)` index. Rule: **a manual write replaces an untouched imported row.** In `SyncService` for `kind == "weight"`, when a different-id row on the target date has `Source = google_health`, hard-delete it in the same transaction before the upsert. Hard delete is safe because the row is server-originated, was never user-edited, and the bootstrap refresh replaces the client's copy.

Phase 0 must first establish what happens today when two devices log the same empty date offline, or log a date that has a deleted row. The same unique index governs that case, and the fix should share one code path.

### Trigger and cost

- Run the import inside the separate active-user `/google-health/sync-data` pass, after outbound uploads, so the steps read can return independently. It is gated by the import preference, the granted read scope, and the 2-minute cache, with `force` from Settings Sync.
- Do not add it to the daily `/internal/google-health-sync` sweep in v1. Check-ins happen while the app is open, so the active pass already sees fresh data.
- Errors map onto the existing warning model (`reconnect_required`, `permissions_missing`, transient). An import failure never fails the steps result.

### Consent and preference

- Add a read scope for health metrics. **Unverified:** the exact scope string, whether it combines with the current `.writeonly` scope or replaces both with a read/write scope, and whether adding it triggers Google OAuth app re-verification. Phase 0 settles this.
- Connection fields: `WeightImportEnabled`, `WeightImportRevision`, `WeightImportLastSuccessAt`, last failure code/message. Expose them as `WeightImport` on the sync status next to `WeightSync`.
- Connect requests the read scope when import is chosen. Existing connections without it show "Reconnect to import weigh-ins" and stay outbound-only until then.
- Settings: a separate "Import weigh-ins from Google Health" switch, distinct from the bundled outbound control, because import changes coaching inputs while upload does not. Revisioned like the outbound preferences (`expectedRevision`, 409 on a stale device).
- **Turning the switch off, or disconnecting, keeps every weigh-in already imported.** It only stops future imports and clears the import status. Imported weights are scale readings that are now part of the user's record. Accepted plans, check-ins, and the expenditure trajectory were computed from them. Deleting them as a side effect of a settings switch would silently rewrite trends and coaching history, and turning the switch back on could not restore the same state, because the 31-day window may no longer cover those days. This matches the outbound rule, which keeps already-uploaded Google copies when sync is disabled. The switch's helper text says so plainly: "Turning this off stops new imports. Weigh-ins already imported stay."
- Turning the switch back on resumes filling empty days in the window. Days the user deleted stay deleted, because a tombstone blocks import.

### UI

- The weigh-in list, edit dialog, and Progress weight details show a quiet "From Google Health" source label for `Source = google_health`. The label disappears after the user edits the value.
- Google Health settings show import status: last import time, how many weigh-ins were added, and the reconnect prompt.
- Export includes `source`.
- Extract the new settings section rather than growing `GoogleHealthSettings.tsx` (388 lines).

## Phases

| Phase | Work | Exit evidence |
| --- | --- | --- |
| 0 | Live API spike on a test Google account: read scope string and combination with `.writeonly`, list endpoint/filter/paging for `weight` data points, sample time and offset fields, data-origin metadata. Confirm current behavior for same-date offline collisions and re-logging a date with a deleted weight. Check Google's health-data terms on keeping imported data after the user revokes access. | Recorded response fixtures (redacted) under `tests/`; written answers to the open questions in this file. |
| 1 | Regression tests first (list below), then the migration: `Weight.Source`/`ExternalId` with check constraint; connection import fields. | Failing tests merged with the plan; the migration applies on a fresh database. |
| 2 | `GoogleHealthWeightReadProvider` (list + parse, paging, error classification sharing `GoogleHealthWeightProvider` categories). | Parser tests on the Phase 0 fixtures. |
| 3 | `GoogleHealthWeightImportService` + hook into the active sync pass + status DTO. | Backend import tests green. |
| 4 | `SyncService` same-date replacement rule; `Apply` edits set `Source = manual`. | Collision tests green; existing weight and sync tests unchanged. |
| 5 | Connect/consent, preference endpoint, settings section, source label, export. | Vitest, `google-health.spec.ts` extension, `npm.cmd run test:visual` at 390/768/1440 in both themes. |
| 6 | Update `CLAUDE.md` feature index and **data boundaries** (imported scale weights now feed trend and coaching; steps still do not), regenerate `AGENTS.md`, `README.md`. | `node scripts/sync-docs.mjs --check`, `git diff --check`. |

## Regression tests to write first

Backend (`tests/GoogleHealthWeightImportTests.cs`, `GoogleHealthWeightReadProviderTests.cs`):

- Fills an empty day; earliest reading wins; the date comes from the sample's own offset.
- Skips a day with a manual row, a day with a deleted row, and a point whose resource name is in upload work.
- Skips out-of-range kg and future dates; never writes zero.
- Disabled preference or missing read scope makes no provider call.
- A second run inserts nothing; one revision bump and one trajectory rebuild per pass.
- A manual `Apply` racing the import: the manual row survives and the import skips that date.
- Turning import off during the provider read prevents new imported rows; invalid numeric offsets are ignored, and an incomplete capped provider list fails rather than choosing a permanent daily sample from partial data.
- An offline manual weigh-in with a new id on an imported date replaces the imported row; a manual row is never replaced.
- An imported row never creates `GoogleHealthWeightSyncWork`; editing it sets `Source = manual` and still uploads nothing.
- Turning import off and disconnecting both keep imported weights and make no further provider read; turning it back on fills only still-empty days. Tenancy filters hold for import writes.
- A provider 401/403/429/5xx maps to the existing warning categories without failing steps.

Frontend: import status mapping in `googleHealth.test.ts`; source label rendering; `WeightEntryDialog` editing an imported row targets its id; bootstrap refresh after an import revision.

## Decisions

Agreed 2026-10-01:

1. **Separate import switch**, distinct from the bundled outbound control. This amends the "single control" wording in `CLAUDE.md` in Phase 6.
2. **Turning the switch off or disconnecting retains imported weigh-ins** (see Consent and preference).
3. **Earliest reading per day.**
4. **Default for new connections:** offered and pre-checked at connect, never silently enabled for existing connections.
5. **No history backfill beyond 31 days in v1.** A later one-shot "Import older weigh-ins" action can reuse the same service with a bounded range.

Still to confirm in Phase 0: whether Google's API terms for health data require deleting imported data when the user revokes access. Today's steps cache is deleted on revocation, but steps are a display-only cache, not user records. If the terms require deletion, revocation (not the switch) must remove rows that are still `Source = google_health`, and this plan must be revised.

## Out of scope for v1

- Body fat import. It would use the same pattern later through `GoogleHealthBodyFatSyncService`'s data type.
- Pushing edits of imported rows back to Google; Google likely rejects changes to another app's data points.
- Scheduled background import for inactive users.
- A bulk "Remove imported weigh-ins" action. If it is added later, it must be its own explicit, confirmed, undoable action, never a side effect of the switch. It would soft-delete only rows still `Source = google_health` (never user-edited ones), so those days stay blocked from re-import.
