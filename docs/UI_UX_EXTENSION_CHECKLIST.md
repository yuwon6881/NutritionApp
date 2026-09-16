# UI/UX extension checklist

Use this checklist for every new screen, action, data card, search result, dialog, responsive layout, or animation. It is an instruction file, not a historical report. Future add-ons must update this file and the corresponding tests in the same change when they introduce a new reusable pattern or change an existing contract.

## 1. Inspect before editing

Run focused searches before creating code:

```powershell
rg -n "similar label or behavior" web/src api tests web/e2e
rg --files web/src/components/ui web/src/lib web/e2e
```

Read the closest existing feature and the relevant shared primitive. Check `web/src/index.css` for tokens, breakpoints, focus rules, motion variables, and an existing class before adding CSS. Check `UI_UX_DESIGN_PRINCIPLES.md` for the current component inventory and data/display contract.

Do not reimplement a button, field, form validator, select, date/time picker, modal, action sheet, status surface, motion wrapper, unit formatter, or food batch interaction that already exists. Extend the shared implementation when the behavior is genuinely reusable.

## 2. Choose the existing pattern

- Actions use `Button`; icon-only actions have an `aria-label` and remain keyboard reachable.
- Inputs use `Field`/`Form`/`FileInput`; custom controls use the existing `Select`, `DatePicker`, `TimePicker`, or `SegmentedControl`.
- Dialogs use `Modal` or `ActionSheet`, including dirty-close confirmation and focus restoration.
- Page and panel changes use `MotionScene`/`MotionPanel`; coach step changes use `CoachMotion`. `MotionScene` does not steal focus on its first render. After a committed page change it focuses the destination heading, tagging keyboard navigation for the shared ring and pointer/automatic navigation for a temporary outline-suppressed semantic focus; blur clears that temporary origin.
- Async work uses `useAsyncAction` and the existing sync/status language.
- Food search, portions, serving labels, batch review, swipe, and mobile menus extend `LogFood`, `FoodPicker`, `FoodBasket`, `BatchFoodRow`, and the API service. Search results explicitly distinguish authoritative product data (with declared servings or verified per-100 g) from unverified provider search hits that display a basis-unavailable state. Barcode input embeds the camera trigger inside the field adornment and checks account-private saved mappings before the provider. Missing or incomplete products expose link-existing, label-scan, and manual recovery. "Your foods" supports persistent search and category filtering with structured recent entries. Recipe ingredient search reuses the food search presentation, live calorie card, and portion synchronization; it is a selection-purpose state, not a second search implementation.
- Food timeline cards use an ultra-compact two-line layout without source strings; entry actions use one accessible action sheet for Edit, Copy, Move to, and Delete; copy/move destination dialogs must preserve the entry snapshot, keep date/time validation explicit, and confirm destructive deletion before queueing the existing entry mutation.
- New styling uses semantic Ayu tokens and the existing responsive breakpoints. Avoid inline colors, remote fonts, feature-only typography, and duplicate card/button systems.
- Measurement units use compact system presets (Metric / Imperial) and contextual in-situ `MiniUnitToggle` switches in field headers rather than heavy multi-select fieldsets; full multi-unit configuration remains in Settings.
- The mobile shell uses the existing `Modal`/`ActionSheet` and semantic tokens for safe-area-aware app bars, bottom navigation, bottom-sheet grab handles, touch scrolling, and Android/browser Back dismissal. Preserve keyboard Escape, dirty-close confirmation, protected dialogs, focus restoration, and reduced-motion behavior when extending it.
- External integrations (Google Health) reuse shared components (Card, Button, Modal), hold step data strictly in runtime memory (never IndexedDB/localStorage), provide pre-connect disclosure modals, expose connection status and reconnect prompts in Settings, render discrete missing-data gaps and known-day averages in Progress charts, and link to public policy pages with the Google API Limited Use statement.

## 3. Implement the contract, not just the happy path

For each new interaction, define and render the states that apply:

- initial/empty;
- loading without a disruptive layout flash;
- success with units, dates, source, and basis;
- partial or unknown data;
- offline/retained/pending work;
- retryable error and conflict;
- conflict review taking precedence over secondary prompts that could enqueue another edit for the same protected record;
- compact protein/carbohydrate/fat values in food batch and diary rows at every responsive width, with unknown nutrients still visible;
- recipe ingredient selection displaying live calorie/macro contribution cards, portion selection synchronized with grams, and live recipe-level nutrition preview cards;
- an explicit past-date `No food logged` choice that is not overwritten by an account-level missing-day default;
- a check-in countdown with a disabled muted circular control before the selected local day and an actionable colored circular control only when due;
- weight-goal progress showing the recorded start, current trend or labelled scale fallback, target, percentage, and remaining amount in Goal and Coach history;
- Google Health step synchronization showing fresh/stale/unavailable badges, preserving unknown days as discrete gaps in charts without guessing zeros, and never feeding step metrics into caloric or coaching algorithms;
- disabled or permission-limited action;
- keyboard focus and reduced-motion behavior.

For nutrition data, retain unknowns and uncertainty. Do not guess serving grams, convert millilitres to grams, turn missing calories into zero, or auto-submit an AI estimate.

## 4. Add the right tests

Use the narrowest test that protects the contract, then add browser coverage for visible behavior.

| Change | Required protection |
| --- | --- |
| Pure ranking, formatting, parsing, or responsive calculation | A focused test beside the relevant TypeScript library or in `tests/` for API behavior, including unknown and tie cases |
| Shared component behavior | Extend the existing consumer/browser test and cover keyboard, focus, accessible name, and reduced motion where relevant |
| Screen layout or interaction | An isolated-API Playwright test in `web/e2e`, with light/dark and 390/768/1440 coverage when the screen is responsive |
| Dialog, destructive action, or dirty draft | Browser assertions for focus trapping, Escape/backdrop behavior, confirmation, restoration, and retained draft/error state |
| Food timeline entry actions | Browser assertions for the action sheet, date/time copy and move, delete confirmation, focus restoration, and retained mutation behavior |
| Search or serving contract | API test for ordering/basis discriminator plus browser assertion for the displayed name, serving label, weight, verified per-100 g, and basis-unavailable state |
| Mobile shell, modal, or action sheet behavior | Browser coverage at 390/768/1440 px for safe-area-aware layout, zero horizontal overflow, bottom-sheet presentation, Back/Escape dismissal, focus restoration, and reduced motion |
| Check-in cadence or goal progress display | Date-state unit tests plus browser coverage for the circular due/countdown control and the start-to-target weight journey across the responsive/theme matrix |
| Google Health integration | Unit tests for in-memory sync manager, known-day averaging, and date lookups; API integration tests for OAuth token handling, KMS encryption, multi-tenant duplicate isolation, and export redaction |
| Animation | Browser assertion with `reducedMotion: 'reduce'` and, if the motion itself matters, a bounded no-preference assertion; content must remain usable without motion |

Prefer accessible locators (`getByRole`, `getByLabel`, `getByText`) over CSS implementation details. Use a CSS selector only for a structural invariant such as zero horizontal overflow or a known layout hook.

## 5. Run verification

From the repository root:

```powershell
dotnet test tests/Nutrition.Tests.csproj
```

From `web/`:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:visual
```

The browser suite must use the dedicated isolated local API/database. Never aim it at production or a personal diary. If a live provider, camera, physical device, deployment, or external credential is not available, report that evidence boundary instead of calling it verified.

For a visual review, boot the isolated local application, inspect the changed screen at phone and tablet widths, and check both themes. Record any intentional skip or unavailable provider in the handoff/verification report.

## 6. Update the living instructions

If the change adds or changes a reusable component, breakpoint, motion rule, data-display convention, or testing expectation:

1. update `docs/UI_UX_DESIGN_PRINCIPLES.md`;
2. update this checklist;
3. update `AGENTS.md` and `CLAUDE.md` if the repository-wide instruction changes;
4. add or update the regression and browser tests;
5. keep the two instruction files identical when editing their shared repository guidance.

Do not merge a new visual convention that exists only in a component file. The instruction, implementation, and tests are one contract.
