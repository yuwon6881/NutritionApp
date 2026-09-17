# NutritionApp guidance

Applies only to this independent repository; app-specific rules override the parent's FinancialApp rules. `CLAUDE.md` is canonical; keep `AGENTS.md` byte-identical. After editing, run `node scripts/sync-docs.mjs`, then verify with `node scripts/sync-docs.mjs --check`.

## Keep this guidance concise

- Update the implemented-feature index in the same change as a feature addition, removal, or material behavior change. Edit an existing bullet before adding one; group related capabilities and link to details instead of keeping a changelog here.
- Record implemented behavior only; label incomplete work in a plan. Keep this file near 100 lines or fewer. Put enhancement findings in `ENHANCEMENT_PLAN.md`, product details in `README.md`, and UI detail in the two design documents below.

## Implemented feature index

- FitnessAccount central sign-in and account profile/settings; consumer sessions and account-scoped data.
- Food diary, explicit logging-day decisions, batch entry, copy/move, shared food search, saved/custom foods, recipes, barcode lookup/private mappings, and editable AI text/photo/label estimates.
- Offline retained edits and image drafts, automatic synchronization, retry and conflict review.
- Weight and body records/photos, goal phases, macro/weekly targets, server coaching/check-ins, expenditure estimates, and progress/energy-history charts.
- Google Health steps and Workout summaries; integration settings and account exports. The Dashboard steps panel appears only after Google Health status resolves to connected or reconnect-required. These integrations do not automatically change calorie or macro targets.

## UI standardization

- Read `docs/UI_UX_DESIGN_PRINCIPLES.md` and `docs/UI_UX_EXTENSION_CHECKLIST.md` before UI work. Update both only when their reusable patterns or contracts change.
- Reuse `web/src/components/ui/` and existing feature flows. Actions use `Button`; forms use `Form`/`Field`/`FileInput`; selectors, dates, dialogs, panels, and sync feedback use their existing primitives. Card or panel failures use the shared `CardFeedback` surface with an accessible announcement and optional recovery action; field validation remains beside its field. Raw buttons belong inside shared primitives, not new feature code. Extend a primitive before creating a parallel implementation.
- Food search, recipe selection, barcode recovery, servings, and batch review extend `FoodPicker`, `LogFood`, `FoodBasket`, and their shared helpers. Never create a second search/ranking or portion-conversion contract.
- Preserve Ayu light/dark semantic tokens, bundled Inter Variable, tabular numerals, spacing, typography, and focus rules in `web/src/index.css`. No feature-specific fonts, hard-coded colors, or parallel token systems.
- Reuse `MotionScene`, `MotionPanel`, `SelectionIndicator`, and `CoachMotion`; preserve shared durations/easing and reduced-motion behavior. Content, errors, focus, and saves never wait for animation. No idle attention-seeking motion.
- Keep copy factual: labels, units, dates, sources, uncertainty, errors, and next actions; avoid slogans and redundant introductions.
- Preserve the <640 / 640-1023 / >=1024 px layout tiers. Verify 390/768/1440 px in both themes, 44 px compact/medium controls, no horizontal overflow, keyboard operation, visible focus, dialog focus restoration, Back/Escape dismissal, and accessible names.
- Include loading, empty, unknown, error, disabled, offline, and conflict states; update matching skeletons when layout changes. Ordinary saves are automatic; use existing retained-work feedback, not a routine sync button.

## Code standardization

- Inspect Git status first; preserve unrelated/concurrent edits. Search shared components, hooks, `web/src/lib/`, DTOs, and API services before adding code. Do not commit, push, or deploy unless requested.
- Keep React components and endpoints thin; separate view coordination into focused hooks and pure calculations into `web/src/lib/` or API services. Reuse validation, formatting, units, request/error handling, and domain rules.
- Prefer explicit types, clear names, small functions, and readable formatting. Avoid `any`, compressed one-line logic, dead code, swallowed errors, and speculative abstractions. Comments explain constraints and reasons.
- Aim for <=300 lines per new source file; split before 500 along responsibility boundaries. Do not grow oversized coordinators; extract the touched responsibility. Generated migrations are exempt. Do not compress code to meet the limit.
- Keep server validation authoritative and mirror it through shared client rules. Preserve cancellation/timeouts, tenancy, idempotency, optimistic ordering, revision checks, and unknown values. Add regression coverage before changing auth, sync, or coaching calculations; never rewrite applied migrations.

## Data boundaries

- FitnessAccount alone stores credentials. Use immutable `IdentitySubject`; display name is mutable metadata. Do not introduce consumer passwords or local registration.
- Open returning accounts from account-scoped cache while validating sessions. Keep food/weight entry available through network delays, persist mutations/image drafts before dispatch, retry on reconnect/foreground, and ignore stale responses. First sign-in requires online access. Never discard unsynced work to hide errors.
- Today stays open in the profile time zone; past food dates automatically count as complete. Missing intake needs an explicit fasting/not-logging decision; never infer zero or overwrite an explicit incomplete/not-logging choice. Keep day resolution consistent across coaching, charts, offline projection, and archived nutrient summaries; archived meal details remain read-only.
- Not logging preserves weights/trends and provisional/accepted estimates but cannot justify intake-based recalibration without sufficient evidence. AI results remain editable drafts until explicit logging. Never invent nutrients, serving weights, quantity basis, or volume-to-mass conversions.
- Server coaching is authoritative: preserve equations, thresholds, immutable accepted plans, revision checks, idempotent acceptance, date-derived age, and all three stored macro targets. Versioned expenditure snapshots are advisory; Today changes only when acceptance atomically activates seven dated targets.
- Coaching cadence is independently revisioned; Monday is default, and weekday edits become due on the next local occurrence without changing the active plan.
- Google Health steps are read-only and display-only, held in browser runtime memory rather than IndexedDB/localStorage. Disconnect/revocation clears credentials and step data. Steps never feed expenditure, coaching, targets, or day completion.
- Nutrition owns scale/trend weight and goals; Workout owns sessions/progression/PRs. Cross-app summaries are informational and never automatically change calories/macros. Preserve account isolation, private-image cleanup, and integration credential protection.

## Verification

- Frontend: `web/`; API: `api/`; API regressions: `tests/`; browser tests: `web/e2e/`. Use Node 24 and the repository's .NET SDK requirements.
- From repository root: `dotnet test tests/Nutrition.Tests.csproj`. From `web/`: `npm.cmd run check:docs`, `npm.cmd run check:standards`, `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`; UI/shared-surface changes also require `npm.cmd run test:visual`.
- Browser tests reset accounts: use an isolated development API/database, never production or a personal diary. Serialize shared build/browser output when other work is running.
- Verify documentation equality and `git diff --check`. Report commands and distinguish source/test evidence from live-provider, browser, or deployment evidence; skipped checks remain unverified.
