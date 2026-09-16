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

The mobile shell follows platform conventions without changing the web data model: the app bar and bottom navigation respect `safe-area-inset-*`, the app bar remains available while a long page scrolls, and compact dialogs present as bottom sheets with a visible grab handle. The shared `Modal` adds one history entry while open so Android/browser Back dismisses the active surface; dirty and protected dialogs keep their existing confirmation or dismissal rules. Keep these behaviors accessible from keyboard Escape and reduced-motion modes as well.

## Existing building blocks

Reuse these components and hooks before writing local equivalents:

| Need | Existing implementation | Extension rule |
| --- | --- | --- |
| Buttons and actions | `web/src/components/ui/Button.tsx` | Use its `primary`, `secondary`, `tertiary`, and `destructive` variants. Keep meaningful accessible names and 44 px touch targets on compact layouts. |
| Labels, inputs, errors, and submit behavior | `Field.tsx`, `Form.tsx`, `FileInput.tsx` | Use the shared validation and first-invalid-focus behavior. Do not rely on native validation bubbles or build a feature-only field wrapper. |
| Selects and segmented choices | `Select.tsx`, `SegmentedControl.tsx` | Use the existing keyboard, focus, selection, and responsive patterns. Use `data-layout="equal"` or `data-layout="scroll"` when appropriate. |
| Continuous and range inputs | `Slider.tsx` | Use for continuous rate, percentage, or scalar inputs with pointer capture, keyboard step navigation, optional `recommendedRange` track indicators, and contextual pace badge feedback. Use the shared `CircularSlider` export for bounded goal weights or durations that benefit from an arc control; keep equivalent values and units visible beside the dial. |
| Dates and times | `DatePicker.tsx`, `TimePicker.tsx` | Reuse their dialog/popover boundaries, keyboard behavior, date formatting, and focus restoration. |
| Dialogs and destructive/dirty-close flows | `Modal.tsx`, `ActionSheet.tsx` | Preserve focus trapping, Escape handling, backdrop intent, inert editor content, dirty confirmation, and focus restoration. |
| Panels and cards | `Card.tsx` plus the `.panel` and semantic classes in `index.css` | Prefer a semantic panel and existing spacing over a new card class. A new repeated surface belongs in the shared layer. |
| Navigation and committed page transitions | `App.tsx`, `MotionScene`, `MotionPanel`, `SelectionIndicator` | Keep routing in the app shell and let the existing motion wrappers handle destination focus and bounded entrance movement. `MotionScene` leaves the first rendered page heading alone, then focuses a destination heading only after a real page transition. Keyboard navigation marks that temporary heading focus with the visible ring; pointer and automatic navigation keep semantic focus without a keyboard rectangle, and the marker clears on blur. |
| Coach step motion | `CoachMotion.tsx` | Use `useCoachSteps`, `CoachLayout`, `CoachWait`, and `CoachNumber` for coach interactions rather than inventing another step animation. |
| Async and sync feedback | `useAsyncAction.ts`, `SyncStatus.tsx` | Keep pending, retained, retryable, and conflict states explicit. Do not hide failed work behind a spinner or reset. Conflict review takes priority over secondary blocking prompts such as missed-day decisions, so a second edit cannot be queued for the same protected record. |
| Food logging | `LogFood.tsx`, `FoodPicker.tsx`, `FoodBasket.tsx`, `BatchFoodRow.tsx`, and `useFoodBasket.ts` | Extend the existing selection, review, batch, swipe/menu, serving, and AI-draft flows. Search results are hydrated and ranked by `FoodSearchService`; do not add a second client-side ranking contract. |
| Units and display formatting | `web/src/lib/units.ts`, `format.ts`, `types.ts`, `MiniUnitToggle.tsx` | Use the account's energy, weight, and height preferences and the shared display/input helpers. Onboarding and measurement inputs prefer compact system presets (`Metric` / `Imperial`) and contextual in-situ `MiniUnitToggle` switches in field headers rather than heavy multi-select fieldsets. |

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

Diary timeline entries expose one keyboard-accessible action surface for Edit, Copy, Move to, and Delete. Copy and Move to preserve the logged snapshot and allow an editable date through today plus an optional time; Delete is confirmed before the existing retained mutation is queued. Keep drag/drop, group move, and Copy day as complementary shortcuts rather than separate mutation contracts.

For a past date, `No food logged` is an explicit open/incomplete choice. A configured fasting or not-logging default may resolve genuinely unreviewed dates, but must not immediately overwrite that explicit choice.

Check-in cadence has one visible action contract:

1. The check-in control is always visible when a profile exists, with the next local check-in date and a day countdown shown before it is due.
2. Before that date, the circular control is visibly muted and disabled; on the selected local day it becomes a colored, keyboard-accessible circular action with the progress ring complete.
3. Countdown state is derived from the profile timezone, selected weekday, latest accepted plan, profile revision, cadence changes, and explicit declines. Do not make the control clickable early or hide the schedule behind the dialog.

Weight-based goals expose the journey in both the active goal summary and Coach history: the recorded phase starting weight, current trend (or clearly labelled scale fallback), target weight, percentage, and remaining amount use the account weight unit. Missing trend data remains visible as unavailable rather than being inferred.

## External integrations and Google Health

External health integrations connect third-party activity data without polluting the core metabolic engine:

- **Strictly visual and informative**: Google Health step counts are purely visual. They must never affect calories, expenditure estimates, coaching proposals, macro targets, or day-completion logic.
- **Runtime-only storage**: To protect privacy and adhere to data segregation guidelines, Google Health step data and sync states are held in runtime memory only. Step data must never be written to `localStorage` or `IndexedDB`.
- **Pre-connect disclosure**: Before initiating the Google OAuth flow, users are presented with a focused disclosure modal outlining data requested (`steps`), storage principles (memory only, encrypted at rest on server), that steps will not modify nutrition goals or calories, and links to public privacy policies.
- **Connection management**: The Settings integration panel surfaces connection state (`Connected`, `Reconnect required`, or `Disconnected`), last sync time, a Reconnect action when grants are revoked or expired, and a destructive confirmation dialog for disconnects.
- **Freshness and honest unavailability**: The Today steps card displays the step count with an explicit freshness indicator (`Fresh`, `Stale`, or unavailable warning). When step data is missing for a given day, it displays an honest `—` or empty state rather than inferring zero.
- **Discrete 30-day activity trend**: The Progress tab features a compact 30-day step chart with a fixed 0–12k+ vertical baseline. Missing days render as discrete gaps rather than connecting false zero data points. A calculated known-day average explicitly excludes missing dates.
- **Public policy pages**: Unauthenticated routes (`/privacy`, `/terms`, `/help/google-health`) are accessible from the authentication screen and disclosure modal, containing the mandatory Google API Limited Use disclosure and data revocation instructions.

## Review standard

Before considering a UI change complete, confirm:

- existing shared components and tokens were reused;
- light and dark themes remain legible;
- 390, 768, and 1440 px have no overflow or clipped actions;
- keyboard focus, accessible names, 44 px controls, dialog behavior, and reduced motion remain correct;
- loading, offline, error, unknown, and partial states are honest;
- the feature test covers the behavior and the browser matrix covers the visible interaction;
- this document and `UI_UX_EXTENSION_CHECKLIST.md` are updated if a reusable pattern or contract changed.
