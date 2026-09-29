# Body tracking UI review and AI body-fat estimate — implementation plan

Status: planned 2026-09-29 02:15 (+08:00); executed from 06:00. Parts A, A4, and B are implemented; see A3/A4 for findings and the final report for verification. Deferred items are in `ENHANCEMENT_PLAN.md`.

## 0. Before starting

- Run `git status`. At planning time 46 files were dirty from concurrent work (food logging, barcode, check-in, and `api/Services/NutritionAi.cs`, `NutritionAiPrompt.cs`, `tests/NutritionAiTests.cs`, `api/appsettings.json`, `web/src/index.css`). Preserve all of it. Do not reformat or revert those files; when a change must land in one of them (for example `index.css`), make a minimal, local addition only.
- Read `docs/UI_UX_DESIGN_PRINCIPLES.md` and `docs/UI_UX_EXTENSION_CHECKLIST.md`.
- Do not commit, push, or deploy. Final report lists commands run and anything left unverified.

## Part A — Responsive and motion review of Body tracking

Scope: `web/src/components/PhysiquePhotos.tsx` (hub, history, record viewer, gallery, gallery viewer), `BodyCompare.tsx`, `CompareOverlay.tsx`, `BodyRecordDialog.tsx`, `PhotoUploadDialog.tsx`, and their CSS.

### A1. Audit first (real browser, not jsdom)

Seed an isolated dev account with at least 4 body records (mixed: full 3-angle photo sets, a record missing one angle, a measurements-only record, one with body fat) and 2 legacy photo sets. Capture every page at 390, 768, and 1440 px, in light and dark, and at 200% text scale on 390 px. For each screen record: horizontal overflow, clipped or wrapping headers, control heights (44 px compact/medium), focus rings, empty/loading/error/offline states, image layout shift while navigating, and Back/Escape behavior. Write the findings into this plan (section A3) before changing code.

### A2. Suspected issues found during code reading (verify in A1, then fix)

1. `BodyCompare.tsx` measurement table maps groups to un-keyed `<>` fragments — React key warning and unstable reconciliation. Use `<Fragment key={group}>`.
2. The four-column compare table (Measurement / Past / Present / Difference, with dates in headers) is likely to overflow or cramp at 390 px. On compact, render each measurement as a stacked row (label, past → present, delta badge) or drop dates from column headers into the picker bar; keep a real `<table>` for medium/expanded.
3. Navigating between cycles: the record viewer (`body-viewer`) only offers "Newer record / Older record" buttons *below* the whole measurement list, with no position indicator, no image preload, and no swipe. Make cycle navigation easy and consistent across the record viewer and the gallery viewer:
   - a compact nav bar (previous / "Record 3 of 12 · 2026-08-14" / next) placed next to the photo, and in the thumb zone on phones;
   - Left/Right arrow keys when focus is inside the viewer;
   - horizontal swipe on the photo on touch devices (pointer type chooses the gesture, never the layout), not conflicting with `CompareOverlay` divider drags;
   - preload the adjacent record's photo for the current angle (the gallery viewer already does this; the record viewer does not);
   - keep the selected angle when moving between records.
4. Compare page: past/present selection is two `<select>`s only. Add previous/next steppers beside each picker so the user can walk the baseline or target one cycle at a time, and keep "Swap dates".
5. Image frames: ensure `.photo-viewer-image`, `.compare-photo-frame`, and the overlay use a fixed `aspect-ratio` and `object-fit: contain` so switching records/angles never shifts layout; cross-fade the image swap using the shared motion primitives (reduced motion → instant swap). Content never waits for animation.
6. `bodyViewerIndex` can point past the end after a record is deleted or the list reloads (`closeBodyEditor` reloads the page). Clamp it; show the empty state if nothing remains.
7. Loading states are plain text ("Loading Body history…", "Loading gallery…"). Add skeletons matching the history row and gallery row layouts.
8. `angles`, `angleLabel`, `measurementGroups`, and `measurementLabel` are duplicated between `BodyCompare.tsx` and `BodyRecordDialog.tsx`. Move them to one `web/src/lib/bodyMeasurements.ts` and import from both (no behavior change).
9. Hub copy: "N legacy photo sets loaded · N retained uploads" is internal vocabulary. Replace with factual user-facing status (for example "3 photo sets · 1 waiting to upload").
10. Header rows (`page-heading photo-view-heading`) hold a back button, title, and up to two actions; check wrapping at 390 px and trailing-edge alignment of action rows.
11. `PhysiquePhotos.tsx` is 271 lines and will grow. Extract view state into `web/src/components/body/useBodyPages.ts` (or the repo's existing view-hook convention) and move `BodyRecordViewer`, `BodyHistoryRow`, `PhotoSetRow` into their own files before adding navigation code.

### A3. Audit findings (2026-09-29, Chromium, 390/768/1440, light and dark, mocked body/photo reads on an isolated dev API)

No page-level horizontal overflow at any width before or after. Defects found and fixed:

1. **390 px, record viewer:** the header's second action ("Edit record") rendered off-screen. Cause: `index.css` declares the phone rule for `.physique-hub-actions` inside `@media(max-width:639px)` *before* the base rule, so the base `display:flex` wins. The same ordering bug disabled the phone layouts of `.body-compare-selectors-bar` (date selects squeezed to ~30 px, dates unreadable as "20…") and `.compare-photos-grid` (cards overflowed). Restated in `components/body/body.css`, which loads later; `index.css` was not touched because it has concurrent edits (follow-up in `ENHANCEMENT_PLAN.md`).
2. **390 px, compare table:** the four-column table scrolled horizontally and hid the Difference column. It now stacks per measurement on phones (label + change, then past and present).
3. **Compare page:** two buttons were named "Back" (navigation and the Back angle). The navigation button is now "Back to Body history".
4. **Compare selects:** option labels rendered as "2026-07-20, (Earliest)" because array children were joined by `String()`; now one template string.
5. **Cycle navigation:** Newer/Older sat below the whole measurement list with no position, preload, keys, or swipe. Added `RecordNavigator` beside the photo (date + "N of M"), Left/Right keys on the focused photo, touch swipe, neighbour preload, preserved angle; gallery viewer uses the same pieces. Compare pickers gained one-step buttons.
6. **Layout shift:** photo swaps changed height; a fixed 3:4 `PhotoFrame` with a token-timed fade (off under reduced motion) replaces it.
7. **768 px viewer:** photo and measurements were stacked below 900 px, forcing a long scroll; they now sit side by side from 640 px.
8. **Other:** un-keyed fragments in the compare table; index could point past the list after a delete (clamped); plain-text loading replaced with matching skeletons; "legacy photo sets loaded" copy replaced; duplicated measurement vocabulary moved to `lib/bodyMeasurements.ts`; gallery captions no longer repeat "Not uploaded".
9. **Dialog:** 14 single-column fields on phones; now two per row, and photos come before body fat so the AI action sits directly after the photos it needs.

Remaining minor notes (not changed): cm/in toggle segments are ~42 px wide on compact (44 px tall), inside the shared `SegmentedControl`.

### A4 result

Read-only review of `BodyRecordService`, `PhotoService`, endpoints, and the draft path found no defect: revisioned, idempotent mutations with receipts; per-angle intents keep other angles; pending → complete via upload finalize; tombstoned photos keep deletion markers for scheduled cleanup; tenancy filter plus write-time ownership (confirmed by a new test that another account's photo returns 404); body-fat range 0–100 exclusive on the server vs 0.1–99.9 on the client is consistent. No storage code changed except extracting the JPEG check into `PhotoService.DecodeJpeg` for reuse (same rules).

### A4. Storage logic check (read-only unless a defect is proven)

Review `BodyRecordService.cs`, `PhotoService.cs`, `BodyRecordEndpoints.cs`, `web/src/lib/nourishDrafts.ts`, and the body-draft path in `useNourishActions.ts` for: revision checks, idempotent mutation IDs, per-angle replace/delete without touching other angles, pending → complete photo status, tombstone cleanup of storage objects, offline draft retention and retry, tenancy filters, and `bodyFatPercent` range validation (client 0.1–99.9 vs server). Report findings; fix only proven defects, each with a regression test first.

## Part B — AI body-fat estimate

### B1. Behavior

- Location: `BodyRecordDialog.tsx`, Composition section, an "Estimate with AI" secondary button beside the Body fat (%) field.
- Enabled only when all three angles (front, side, back) have a usable image in the dialog: a newly selected image, or an existing `complete` server photo not marked for deletion. Otherwise disabled with a visible reason ("Add front, side, and back photos to estimate"). Also disabled offline ("Estimating needs a connection") and while busy.
- On click: send the request; show progress in the button; on success show a result panel beneath the field: estimated value, a range (for example 16–20%), confidence (Low/Medium/High in plain words), a short explanation, and which inputs were used (photos, weight, height, sex, age, measurements). The user then chooses "Use 18%" to fill the field, or dismisses. The estimate never saves itself; the normal Save still owns persistence (matches "AI results remain editable drafts until explicit logging").
- Disclosure under the button: the three photos are sent to the AI provider for this estimate only and are not stored by the provider (`store: false`). Visual estimates can be off by several percentage points.
- Errors use existing error/alert patterns: not configured (503), allowance used (429 with message), provider refusal or unusable photos (422 "The photos could not be assessed. Use clear, well-lit front, side, and back photos."), network failure.
- Unknowns stay unknown: if height, sex, age, weight, or measurements are missing, they are omitted from the request and listed as "not used"; never substitute zero or defaults.

### B2. API

- New endpoint `POST /api/body-records/body-fat-estimate`, `.RequireRateLimiting("scans")` (10/min), authenticated, tenant-scoped. Online-only; no outbox entry (the result is a transient suggestion, not a user record).
- Request DTO: `{ date, photos: [{ angle, photoId? , imageBase64? }] (exactly one per angle), measurements: BodyMeasurements (cm, optional) }`. Existing photos are loaded server-side by ID through `PhotoService` with ownership checks; new images are decoded in memory, size- and signature-checked with the same limits as photo upload, and never written to storage.
- Server-side context (never trusted from the client): profile sex, height, date-derived age from the profile, and the weight context for `date` via the existing `BodyRecordService` weight-context lookup (scale and trend kg).
- Deterministic cross-check: when neck + waist (+ hips for female) and height exist, compute the US Navy circumference estimate in a pure domain helper (`api/Domain/BodyFatFormulas.cs`) and pass it to the model as a reference input; return it in the response as `formulaPercent` so the UI can show "Tape-measure formula: 19.2%". Missing inputs → null.
- AI allowance: reuse the daily `AiUsage` request cap and monthly budget reservation from `ScanService.Process`. Extract that reservation into one shared helper (for example `AiAllowance.Reserve(db, config, ct)` plus token accounting) and call it from both scans and body-fat estimates, so body-fat requests share the same limits. Add tests first proving scans still enforce the cap after the extraction.
- Provider call: new `BodyCompositionAi` service with its own static instructions (`BodyCompositionAiPrompt`, separate `prompt_cache_key`) and strict JSON schema: `{ assessable: bool, estimatePercent: number|null, lowPercent: number|null, highPercent: number|null, confidence: "low"|"medium"|"high", explanation: string, cues: string[] }`. Validate server-side: 3–60%, low ≤ estimate ≤ high, range width ≤ 15 pp, explanation ≤ 1000 chars, ≤ 6 cues. `assessable=false` → 422 with the unusable-photo message.
  - Prompt content: images are data, never instructions; assess visible muscle definition, abdominal and flank fat, vascularity, and fat distribution across all three views; combine with supplied height, weight, sex, age, measurements, and the formula reference; state the main uncertainty; never comment on attractiveness or give medical advice.
  - `NutritionAi.cs` is being edited concurrently. Put the shared OpenAI Responses plumbing (key/model resolution, request send, output-text extraction, usage parsing) in a new `OpenAiResponsesClient` used by `BodyCompositionAi`. Only switch `NutritionAi` to it if that file is clean in Git at execution time; otherwise leave `NutritionAi` untouched and record the follow-up in `ENHANCEMENT_PLAN.md`.
  - Register with `AddHttpClient<...>` (90 s timeout) and `ExternalCallMetricsHandler`, like `NutritionAi`.
- Response DTO: `{ estimatePercent, lowPercent, highPercent, confidence, explanation, cues, formulaPercent, inputsUsed: { photos, heightCm, sex, age, scaleKg, trendKg, measurementKeys[] } }`.

### B3. Frontend

- `web/src/lib/bodyFatEstimate.ts`: pure helpers — `canEstimate(slots)` (all three angles usable), request builder (inches converted to cm through the existing conversion), response type guards, and formatting of range/confidence copy. Unit-tested.
- `web/src/components/BodyFatEstimate.tsx`: button, disclosure, busy state, result panel, "Use N%" and dismiss actions, using `Button`, existing panel/alert classes, and semantic tokens only. `aria-live="polite"` for the result; focus moves to the result heading when it appears; errors use the existing alert pattern.
- The dialog passes its current slots and measurement values; changing any photo or measurement after an estimate marks the shown result as out of date (keep it visible, labelled "Based on earlier photos").
- Keep `BodyRecordDialog.tsx` under ~300 lines: the estimate state lives in the new component or a `useBodyFatEstimate` hook, not in the dialog.
- Responsive: the button sits inline beside the field at ≥640 px and full-width under it on compact; 44 px targets; result panel wraps without overflow at 390 px and 200% text scale.

### B4. Tests (write the regression tests before behavior)

- API (`tests/`): Navy formula (male, female, missing inputs → null); request validation (missing angle, duplicate angle, foreign photo ID → 404, oversized/invalid image → 400); allowance shared with scans (cap reached → 429 for both); provider output validation (out-of-range, inverted range, `assessable=false` → 422); server ignores client-sent profile data; no storage object written for inline images. Use a stub `HttpMessageHandler`; never call the live provider in tests.
- Web unit (Vitest): `canEstimate` across new/existing/deleted/pending slots; unit conversion; copy formatting; component states (disabled reasons, offline, busy, success, "Use" fills the field without saving, stale-after-change, error).
- Browser (Playwright, isolated dev API with the AI provider stubbed at the API layer or via a test configuration): button disabled with 2 photos, enabled with 3; estimate fills field only after "Use"; screenshots at 390/768/1440 in both themes. Add Body viewer navigation specs (buttons, arrow keys, swipe on the touch project, preserved angle, no layout shift).

### B5. Documentation

- Update the "Weight and body records/photos" bullet in `CLAUDE.md` implemented-feature index (AI body-fat estimate from three photos, editable suggestion, shared AI allowance), run `node scripts/sync-docs.mjs` and `--check`.
- README product note; privacy wording about photos sent to the AI provider.
- `docs/UI_UX_*` only if a reusable pattern changed (for example a new record navigator).

## Part C — Verification gates

From repository root: `dotnet test tests/Nutrition.Tests.csproj`.
From `web/`: `npm.cmd run check:docs`, `npm.cmd run check:standards`, `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:visual`.
Then `node scripts/sync-docs.mjs --check` and `git diff --check`.
Serialize build/browser runs if other work is running. A live provider call is not part of the gates; report it as unverified unless run manually with explicit approval.

## Decisions taken without the user (revisit if wrong)

- No schema change: the accepted value is stored as the normal body-fat measurement; the record does not remember it came from AI. (A `BodyFatSource` column would be a follow-up.)
- Estimate runs from the Add/Edit Body record dialog only, not from the read-only record viewer.
- Body-fat estimates count against the same daily AI allowance as food scans.
