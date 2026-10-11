# NutritionApp redesign — Gemini implementation brief

Status: proposed implementation, not implemented.

## Objective and scope

Redesign `D:\App\NutritionApp` across web, PWA and Android: layout, typography, colour, navigation, controls, charts and sheets. Match FinancialApp's level of visual craft; its referenced image was unavailable during planning.

Colours and fonts are explicitly in scope, superseding the rules to preserve Inter and monochrome chrome. Update those rules during implementation; retain shared-component, accessibility and data contracts.

## Research and visual direction

- **[Eat.che by Pocolo](https://www.designrush.com/best-designs/apps/eat-che-app-design)** — mimic whitespace, typography hierarchy, rounded modules and restrained accents. Award evidence: [DesignRush 2025 winners](https://www.designrush.com/best-designs/websites/trends/best-of-design-awards-2025). Published dashboard imagery was visually inspected; use original assets.
- **[MacroFactor](https://macrofactor.com/dashboard-revamp/)** — nutrition summaries, chart-first insights and reachable logging. Its official 2022 dashboard imagery was inspected as a dated pattern reference. Follow its [unified logging](https://help.macrofactorapp.com/en/articles/215-how-to-log-food-in-macrofactor) principles without importing features.
- Apply [Material 3 typography roles](https://m3.material.io/styles/typography/applying-type) and [WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/): clear hierarchy, readable contrast, visible focus and information conveyed beyond colour.

**Direction:** calm, editorial nutrition dashboard. Warm ivory, forest-green actions, readable data colours, spacious composition and precise numbers. Avoid nested cards, excessive pills, decorative gradients, glass effects, stock wellness imagery and motivational filler.

## 1. Establish one replacement design system

- Use locally bundled **Manrope Variable** throughout, with system fallbacks and tabular numerals. Body/input text 16 px; secondary text 14 px; section titles 20 px; page titles 28/32 px; hero figures 40/48 px for phone/desktop. Use weights 400/500/600/700 and body line-height 1.5. Keep uppercase labels rare.
- Starting light tokens: background `#F5F3EE`, card `#FFFFFF`, foreground `#202A25`, muted text `#5B665F`, border `#DADFD7`, primary `#235640`, on-primary white. Dark: background `#121916`, card `#1C2520`, raised `#27332B`, foreground `#EEF3ED`, muted text `#ABB8AE`, border `#3B4940`, primary `#B8D7A8`, on-primary `#172619`.
- Data tokens, light/dark respectively: energy `#16766E`/`#75C8BC`; protein `#B74D42`/`#F29C8F`; carbs `#3B6DB0`/`#9CBFF0`; fat `#8B691A`/`#E8C66E`; weight `#7954A7`/`#C6ADEB`. Keep destructive red distinct from ordinary over-target data. Validate rendered text, chart marks, controls and focus contrast; adjust tokens where needed.
- Replace tokens centrally in `web/src/index.css`, consolidating superseded overrides. Keep existing token names; no parallel theme system.
- Spacing scale: 4/8/12/16/24/32/48 px. Page gutters 16/24/32 px; card padding 20/24 px; card radius 20 px; field/button radius 12 px. Use borders for grouping and restrained shadows only for raised surfaces. Maintain Lucide icons at consistent sizes/strokes.

## 2. Redesign the shared shell and controls first

- Update `App.tsx` presentation; preserve navigation/history, destinations and Add flow. Use labelled phone bottom navigation, tablet rail, and 224 px desktop sidebar with content capped around 1200 px. Keep Settings and Ask AI reachable.
- Rework `components/ui/` first: `Button`, `Card`, `Field`, `Form`, `FileInput`, `Modal`, `ActionSheet`, `SegmentedControl`, selectors, date controls, `SettingRow`, `CardFeedback`, `SyncStatus`, `UndoToast` and `Skeleton`.
- One dominant action per sheet. Use 48 px primary controls and at least 44 px other compact/medium targets. Keep safe-area footers, keyboard-aware placement, Back/Escape behaviour and focus restoration.
- Reuse existing motion primitives and durations. Animate only interaction feedback and meaningful transitions; data and actions remain available immediately and under reduced motion.

## 3. Apply the redesign to every screen

| Surface / entry points | Required composition |
| --- | --- |
| Dashboard — `Today.tsx`, `dashboard/` | Dominant Today panel: left/over, logged ring and target shown once, then macro rows. Connected steps below; two habit tiles; full-width weekly chart; goal/trend pair; Workout last. Preserve due-check-in replacement and uncertain targets. |
| Food Log — `FoodDiary`, `FoodWeekStrip`, `FoodTimeline`, `FoodTimeCard` | Compact date strip/totals; lighter timeline with aligned time, name, portion and energy. Phones retain bare totals and one-line names. Keep swipe, drag, multi-select, copy/move, archives and Undo. |
| Logging — `LogFood`, `FoodPicker`, `FoodBasket`, `BatchFoodRow` | Search-first header; Search/Saved/Barcode/AI control; compact recents/results; clear portions; persistent basket summary/review action. Style recipes and AI consistently. Keep dated batch preview, search triggers, serving basis, camera/gallery and explicit logging. |
| Progress/Body — `Progress.tsx`, `progress.css`, `body/`, `BodyCompare` | Tabs/period selector, large chart, fixed-height date readout and supporting metrics. Preserve scrolling bars and missing-data gaps. Keep 3:4 photos with aligned dates, angles and comparison controls. |
| Coach/check-in — `Coach.tsx`, goal/check-in components | Active targets, next/due check-in and goal journey. Align proposed/current targets with explicit changes and one acceptance action. Restyle onboarding consistently; preserve calculations and cadence. |
| Ask AI — `AiAssistantPanel`, `ai/` | Quiet conversation canvas, readable message width, dated evidence rows, reachable composer and distinct action review. Preserve freshness and uncertainty. |
| Settings/sign-in/dialogs | Same typography and controls; clear settings groups; connection status/recovery beside its integration. Preserve FitnessAccount auth and all actions/preferences. |

## 4. Execution order and boundaries

1. Inspect Git status, design guidance, current source and isolated screenshots; inventory screens and important states before editing.
2. Implement tokens, font, controls and shell; establish Dashboard and logging, then finish every surface above.
3. Reuse hooks, calculations, formatting and components. Extract touched presentation from large coordinators; target new files under 300 lines.
4. Preserve APIs, auth, persistence, offline drafts/queues, optimistic updates, coaching equations, historical targets and integration boundaries. Unknown stays unknown; AI stays a draft; steps/Workout never change targets. Retain existing features/actions.
5. Update all three design documents, README where appropriate, and the relevant implemented-feature bullet when behaviour materially changes. Edit `CLAUDE.md` canonically and synchronize `AGENTS.md` with `node scripts/sync-docs.mjs`.

## 5. Acceptance and delivery

- Inspect every major screen in light/dark at **390/768/1440 px**, plus dense logging at 360 px. Include loading, empty, unknown/partial, error, offline/pending, disabled, due-check-in and rejected-edit states; update skeletons.
- Verify overflow, 200% text enlargement, contrast, keyboard/focus, dismissal/restoration, safe areas, reduced motion and real-touch gestures. Logging must retain its steps and capabilities.
- Run serially: root `dotnet test tests/Nutrition.Tests.csproj`; web `npm.cmd run check:docs`, `check:standards`, `typecheck`, `test`, `build`, **`test:visual`**; root `node scripts/sync-docs.mjs --check` and `git diff --check`. Browser tests must use the isolated development API/database.
- Deliver changed-file summary, before/after screenshots and passed/failed/skipped checks. Physical Android, camera and live-provider behaviour require separate evidence; label unverified results. Do not commit, push or deploy without a separate request.
