# NutritionApp UI/UX design principles

This is the living UI contract for NutritionApp. It records the patterns already present in the application so future work extends the system instead of creating a parallel visual or interaction system. Read it with `docs/UI_UX_EXTENSION_CHECKLIST.md` before adding or changing a screen, control, search result, dialog, or animation.

## Product direction

- Keep the interface restrained, premium, and data driven. Prefer a label, value, unit, date, source, uncertainty, error, or next action over slogans and decorative copy.
- Make the current state understandable without animation. A transition may establish hierarchy, but it must not be the only way to discover a result, error, or action.
- Preserve honest nutrition data. Unknown nutrients, missing serving weights, partial totals, and provisional AI estimates stay visibly unknown or provisional; they are never replaced with guessed zeros, grams, or verified-sounding language.
- Keep ordinary saves automatic and visible through retained-work or actionable-error feedback. Do not add routine refresh or sync buttons when the existing queue and status surfaces already cover the state.
- Keep the server authoritative for coaching and persistence contracts. UI polish must not change equations, revisions, acceptance identity, or historical meaning.

## Visual foundations

The visual foundation is centralized in `web/src/index.css`.

- Typography is the bundled `Inter Variable` family. Do not add remote fonts or feature-specific font families.
- Use the existing Ayu semantic tokens (`--background`, `--card`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, `--primary-tint`, `--ring`, `--destructive`, and the nutrition colors). Light and dark themes are selected with `:root[data-theme=dark]`.
- Use tabular numerals for calories, weights, grams, dates, percentages, chart values, and other comparisons. The root already establishes `font-variant-numeric: tabular-nums`.
- Use the established panel, border, radius, spacing, focus ring, button, field, and status styles. Do not introduce a second token set, shadow language, radius scale, or button implementation.
- Keep page-level styling in `web/src/index.css`; do not attach a new font or color system to a feature component.

## Responsive behavior

The shell has three intentional ranges:

| Range | Existing behavior | Required checks |
| --- | --- | --- |
| Below 640 px | Mobile-first content, five-item bottom navigation, safe-area padding, stacked actions, compact panels | 390 px wide; also check 360 px when the feature is dense |
| 640–1023 px | Compact side rail, tablet spacing, two-column content where it remains readable | 768 px wide |
| 1024 px and above | Labeled sidebar, wider content grid, desktop action rows | 1440 px wide |

All new responsive UI must preserve zero horizontal overflow, readable labels, and usable controls at 390, 768, and 1440 px in both themes. A layout may change structure at a breakpoint, but the action order and accessible name must remain understandable.

The mobile shell follows platform conventions without changing the web data model: the app bar and bottom navigation respect `safe-area-inset-*`, the app bar remains available while a long page scrolls, and compact dialogs present as bottom sheets with a visible grab handle. Back unwinds the innermost surface first: popover, dialog step, selection mode, dialog, then page. Top-level navigation records a page history entry without changing the URL; the shared `Modal` adds one history entry while open; lighter surfaces register through `useBackLayer` (`lib/appHistory.ts`), which keeps at most one guard entry. Dirty and protected dialogs keep their existing confirmation or dismissal rules, and a dialog step with unsaved input falls through to that confirmation. The Capacitor Android shell sends hardware Back through the same history, returns to the Dashboard from a page with no history below it, exits only from the Dashboard root, and applies the current Ayu theme to the native status bar. Popovers dismiss on any pointer (`useDismissablePopover`), not mouse only. Hover styles live behind `@media (hover:hover) and (pointer:fine)` so they never stick after a tap. While the on-screen keyboard is open (`lib/virtualKeyboard.ts`, `data-keyboard="open"`), compact and medium layouts hide the bottom navigation and sync toast and keep the focused field in view. Numeric `Field`s choose a decimal or digits keypad from `step`. Keep these behaviors accessible from keyboard Escape and reduced-motion modes as well.

## Existing building blocks

Reuse these components and hooks before writing local equivalents:

| Need | Existing implementation | Extension rule |
| --- | --- | --- |
| Buttons and actions | `web/src/components/ui/Button.tsx` | Use its `primary`, `secondary`, `tertiary`, and `destructive` variants. Keep meaningful accessible names and 44 px touch targets on compact layouts. |
| Labels, inputs, errors, and submit behavior | `Field.tsx`, `Form.tsx`, `FileInput.tsx` | Use the shared validation and first-invalid-focus behavior. Do not rely on native validation bubbles or build a feature-only field wrapper. |
| Selects and segmented choices | `Select.tsx`, `SegmentedControl.tsx` | Use the existing keyboard, focus, selection, and responsive patterns. Use `data-layout="equal"` or `data-layout="scroll"` when appropriate. The segmented `label` names its button group for assistive technology. Two- or three-option preferences use a segmented choice rather than a select; the `settings-choice` class gives the sunken-track style used in Settings. |
| Settings rows and groups | `SettingRow.tsx`, `SettingsLayout.tsx` | Each preference is one row: label and plain-language effect on the leading edge, control on the trailing edge; below 640 px the control drops under the text, except a lone switch, which stays beside it. Group rows in a titled `SettingsSection`; the sticky section links appear only from 1024 px. |
| Continuous and range inputs | `Slider.tsx` | Use for continuous rate, percentage, or scalar inputs with pointer capture, pointer-id tracking, lost-capture cleanup, keyboard step navigation, optional `recommendedRange` track indicators, and contextual pace badge feedback. Use the shared `CircularSlider` export for bounded goal weights or durations that benefit from an arc control; keep equivalent values and units visible beside the dial. |
| Dates and times | `DatePicker.tsx`, `TimePicker.tsx` | Reuse their dialog/popover boundaries, keyboard behavior, date formatting, and focus restoration. |
| Dialogs and destructive/dirty-close flows | `Modal.tsx`, `ActionSheet.tsx` | Preserve focus trapping, Escape handling, backdrop intent, inert editor content, dirty confirmation, and focus restoration. |
| Panels and cards | `Card.tsx` plus the `.panel` and semantic classes in `index.css` | Prefer a semantic panel and existing spacing over a new card class. A new repeated surface belongs in the shared layer. |
| Navigation and committed page transitions | `App.tsx`, `MotionScene`, `MotionPanel`, `SelectionIndicator` | Keep routing in the app shell and let the existing motion wrappers handle destination focus and bounded entrance movement. `MotionPanel` supports horizontal or fade-only entrance when a form edge must retain its full focus ring. `MotionScene` leaves the first rendered page heading alone, then focuses a destination heading only after a real page transition. Keyboard navigation marks that temporary heading focus with the visible ring; pointer and automatic navigation keep semantic focus without a keyboard rectangle, and the marker clears on blur. |
| Coach step motion | `CoachMotion.tsx` | Use `useCoachSteps`, `CoachLayout`, `CoachWait`, and `CoachNumber` for coach interactions rather than inventing another step animation. |
| Async and sync feedback | `useAsyncAction.ts`, `SyncStatus.tsx` | Keep pending, retained, retryable, and conflict states explicit. Do not hide failed work behind a spinner or reset. Conflict review takes priority over secondary blocking prompts such as missed-day decisions, so a second edit cannot be queued for the same protected record. |
| Card-level errors and recovery | `CardFeedback.tsx` | Use one semantic feedback surface for card or panel failures and warnings. Include a clear message, an accessible alert/status role, and an optional shared `Button` recovery action; keep field validation beside its field. |
| Food logging | `LogFood.tsx`, `FoodPicker.tsx`, `FoodBasket.tsx`, `BatchFoodRow.tsx`, and `useFoodBasket.ts` | Extend the existing selection, review, batch, swipe/menu, serving, and AI-draft flows. Recent foods (`lib/recentFoods.ts`) go straight to the batch review with their last portion, whose Log button takes focus; there is no path that logs without that review. Search-as-you-type waits for a pause and three characters because the provider quota is shared; explicit Search still reports errors. Serving shortcuts (`PortionChips`) only multiply servings and never invent a gram weight. Search results are hydrated and ranked by `FoodSearchService`; do not add a second client-side ranking contract. |
| Units and display formatting | `web/src/lib/units.ts`, `format.ts`, `types.ts`, `MiniUnitToggle.tsx` | Use the account's energy, weight, and height preferences and the shared display/input helpers. Onboarding and measurement inputs prefer compact system presets (`Metric` / `Imperial`) and contextual in-situ `MiniUnitToggle` switches in field headers rather than heavy multi-select fieldsets. |
| Chart scrubbing | `components/ui/useChartScrub.ts`, `lib/chartScrub.ts` | Pointer and touch scrubbing with a vertical crosshair and a fixed value card showing date, value, and source; keyboard arrow stepping and table alternatives stay available. |
| Tactile feedback | `web/src/lib/haptics.ts` | Short tactile confirmation (`hapticTick`) for card lift, selection, log success, barcode hit, and swipe threshold. Native Haptics on Android, vibration on web; silent when reduced motion is on or user disabled haptics in Settings. |

Before adding a component, search `web/src/components/ui`, `web/src/index.css`, and the nearest feature component for the behavior. If a pattern is likely to be used twice, extend the shared component and update this inventory instead of copying it.

## Accessibility and interaction

- Every interactive control needs a stable accessible name, visible focus, keyboard activation, and a target of at least 44 px on mobile and tablet. Icon-only controls use an explicit `aria-label`.
- Rows that act like buttons must support Enter and Space without letting nested controls trigger the row action. Visible mobile menus must remain available alongside swipe affordances.
- Keep focus intentional: page headings receive focus after navigation, dialog focus is trapped and restored, and a newly revealed step or invalid field receives focus.
- Use semantic headings, labels, lists, progress elements, dialogs, and status regions before adding ARIA. Do not use a clickable `div` where a shared `Button` or a native control is appropriate.
- Treat offline, loading, partial, unavailable, and error states as first-class states. Do not infer fasting, zero nutrients, serving grams, or successful synchronization from absence.
- When a retained mutation is in conflict, let the conflict review surface own the next action. Suppress automatic or secondary decisions that could enqueue another mutation for the same protected record until the conflict is discarded or otherwise resolved.

## Motion

Motion is bounded, purposeful, and optional.

- Reuse `MotionScene` for page entrance, `MotionPanel` for committed panel changes, `SelectionIndicator` for selection movement, and `CoachMotion.tsx` for coach steps and numeric emphasis.
- Use the CSS motion variables in `index.css` (`--motion-control`, `--motion-exit`, `--motion-panel`, `--motion-layout`, and the shared easing) for small state changes. Avoid one-off durations and easing curves unless the interaction has a documented reason.
- The destination content must be committed and usable immediately; animation only adds hierarchy or continuity. Never delay a save, error, focus target, or data value until an animation completes.
- Every new animation must work with `prefers-reduced-motion: reduce`. The global reduced-motion rule disables CSS transitions/animations, while JS motion uses `useReducedMotion`.
- Do not add looping or attention-seeking motion to ordinary sync or idle states. Delayed loading indicators are preferable to layout flashes.

## Food search and serving presentation

Food search has one ranking contract:

1. Name relevance is primary. The API ranks normalized name matches before applying any personalization.
2. Among equivalent name matches, a previously logged product may be preferred for that account; a declared gram serving and then provider order break remaining ties.
3. The search index is hydrated through the bulk product lookup before the tie-breaker runs. If hydration is unavailable, the name-ranked results still display and no serving is invented.

`FoodSearchService.PrioritizeResults` owns this ordering. Food results carry an explicit nutrition basis discriminator (`per100g` vs `unverified`). `FoodPicker` owns the existing compact result row and prioritizes declared serving summaries first, verified authoritative `/ 100 g` summaries second, and a concise basis-unavailable state for unverified hits without declared servings. Selecting an unverified coded result resolves its authoritative serving through the barcode endpoint before review. Update the API regression test and the relevant browser coverage whenever this contract changes.

Food logging rows expose the three primary macros as a compact `P`, `C`, and `F` summary in both batch review and the diary timeline. Unknown values remain `—`; a known fibre value may remain available as a secondary `Fi` value in the detailed timeline. Timeline cards adopt an ultra-compact presentation with the food name, energy, and more actions button grouped on the top line, and portion with macros on the secondary line, omitting repetitive source provenance strings for maximum screen density and scanability.

Barcode search embeds the camera trigger directly into the digits input field as a trailing icon action, avoiding separate button rows and unifying manual and camera lookup. A scan resolves account-private saved-food barcode mappings before Open Food Facts, and a miss or incomplete provider result offers link-existing, nutrition-label, or manual recovery without inventing a serving weight. Saved custom foods may carry one optional 8–14 digit barcode; omitted legacy mutation fields preserve the existing mapping.

The "Your foods" selection tab organizes saved foods, custom items, recipes, and recent diary items with persistent search, category segment filtering (`All`, `Favourites`, `Recipes`, `Recent`), and structured recent food cards containing portion and energy context.

Recipe ingredient search links directly to the application's food search capabilities (online provider, saved foods, and barcode lookup) through the same `FoodPicker` used by normal logging. The parent-owned recipe draft survives each selection detour; AI, quick/manual entry, recent snapshots without a reliable basis, custom-food creation, and nested recipe creation are not alternate ingredient tabs. Ingredient search results share the application's food presentation with calories, basis, source, and P/C/F macro badges. When setting an ingredient quantity, a live calorie card displays the scaled nutritional contribution, and declared portions synchronize with editable grams. As ingredients are added or adjusted, a live recipe nutrition preview reflects total batch calories and macros, per-serving targets, and cooked-yield nutrient density.

Diary timeline entries expose one keyboard-accessible action surface for Edit, Copy, Move to, and Delete. Copy and Move to preserve the logged snapshot and allow an editable date through today plus an optional time; Delete queues the retained mutation at once with a five-second undo window. Diary cards use one touch gesture (`lib/cardGesture.ts`): hold still for 400 ms to lift the card, then release to select it or move to drag it to another hour; moving clearly sideways before the hold reveals Copy, Move, and Delete; any other early movement scrolls the page. The Food Log week strip changes day by tap or sideways swipe (`useHorizontalSwipe`), with Previous/Next and the date picker as alternatives. Deletion is immediate and undoable: `store.mutate(op,{holdMs})` keeps the request in the outbox for the undo window and `store.undo` removes it before it is sent (`lib/heldMutations.ts`); lists derived from server summaries must hide queued deletions at once. The shared `UndoToast` announces the result; there is no delete confirmation dialog for food or weigh-ins. Multi-selection is activated by that hold or the toolbar Select button, revealing checkboxes and a floating bulk action bar for bulk deletion, bulk move (supporting same-day different time, today, and other dates with original times preserved), and clipboard copying. The persistent in-app clipboard displays an actionable banner across days and allows pasting directly into specific hourly timeline slots or to the viewed date. Keep drag/drop, group move, bulk actions, and Copy day as complementary shortcuts rather than separate mutation contracts.

For a past date, `No food logged` is an explicit open/incomplete choice. A configured fasting or not-logging default may resolve genuinely unreviewed dates, but must not immediately overwrite that explicit choice.

Check-in cadence has one visible action contract:

1. The check-in control is always visible when a profile exists, with the next local check-in date and a day countdown shown before it is due.
2. Before that date, the circular control is visibly muted and disabled; on the selected local day it becomes a colored, keyboard-accessible circular action with the progress ring complete.
3. Countdown state is derived from the profile timezone, selected weekday, latest accepted plan, profile revision, cadence changes, and explicit declines. Do not make the control clickable early or hide the schedule behind the dialog.

Weight-based goals expose the journey in both the active goal summary and Coach history: the recorded phase starting weight, current trend (or clearly labelled scale fallback), target weight, percentage, and remaining amount use the account weight unit. Missing trend data remains visible as unavailable rather than being inferred.

## External integrations and Google Health

External health integrations connect third-party activity data without polluting the core metabolic engine:

- **Separate streams**: Google Health step counts remain purely visual and runtime-memory-only; optional weight sync is a distinct outbound stream with its own permission, preference, pending count, last success, reconnect-required, failed, and unknown-upload states. Neither stream affects calories, expenditure estimates, coaching proposals, macro targets, or day-completion logic; NutritionApp remains authoritative for local weights and trends.
- **Pre-connect disclosure**: Before initiating OAuth, the focused disclosure lists steps and the optional `Sync weight to Google Health` choice. It explains that only newly accepted recorded scale entries qualify, historical entries are excluded, edits/deletions mirror in the background, kilograms become grams at profile-local noon with the chosen offset, disabling does not delete Google copies, and unknown creates require duplicate-risk review.
- **Connection management**: Settings surfaces connection state (`Connected`, `Reconnect required`, or `Disconnected`) independently from weight preference/status, uses `CardFeedback` for actionable failures, keeps local saves available during provider errors, and uses a destructive disconnect dialog. A different Google identity requires disconnecting first; disconnect removes local credentials, queue records, and mappings but cannot delete already-uploaded Google copies.
- **Workout summary availability**: A temporary Workout token or provider failure keeps the active connection and cached completed summaries in place while Dashboard and Progress show a generic sync warning through the shared feedback surface.
- **Freshness and honest unavailability**: The Today steps card displays the step count with an explicit freshness indicator (`Fresh`, `Stale`, or unavailable warning). When step data is missing for a given day, it displays an honest `—` or empty state rather than inferring zero. The Dashboard keeps calories and macros first, then shows a compact steps insight only for a connected Google Health account; it hides the panel while disconnected, reconnect-required, or unresolved, and surfaces a sync warning when today’s data is unavailable.
- **Discrete 30-day activity trend**: The Progress tab features a compact 30-day step chart with a fixed 0–12k+ vertical baseline. Missing days render as discrete gaps rather than connecting false zero data points. A calculated known-day average explicitly excludes missing dates. Each day marker is clickable and keyboard-activatable so the selected date details do not depend on hover; Settings `Sync now` explicitly bypasses the short server cache and reports loading or provider-warning state.
- **Google Health data controls**: The authenticated Settings integration shows the Google API Limited Use disclosure, rolling step retention, the weight upload boundary, background processing, retry/unknown recovery, and disconnect effects. The app does not expose public privacy or terms routes.

## Review standard

Before considering a UI change complete, confirm:

- existing shared components and tokens were reused;
- light and dark themes remain legible;
- 390, 768, and 1440 px have no overflow or clipped actions;
- keyboard focus, accessible names, 44 px controls, dialog behavior, and reduced motion remain correct;
- loading, offline, error, unknown, and partial states are honest;
- the feature test covers the behavior and the browser matrix covers the visible interaction;
- this document and `UI_UX_EXTENSION_CHECKLIST.md` are updated if a reusable pattern or contract changed.
