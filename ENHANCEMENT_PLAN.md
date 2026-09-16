# NutritionApp enhancement plan

Source review: 2026-09-16. This is proposed work, not implemented fixes or a browser/accessibility certification. File sizes are review-time snapshots. The guidance pair was already present; this review adds explicit code standards and feature-index maintenance.

## Findings and recommended sequence

| Priority | Observed gap | Enhancement | Completion evidence |
| --- | --- | --- | --- |
| 1 | Feature actions bypass shared `Button` in `LogFood.tsx`, `MacroSetup.tsx`, `WeeklyProgramSetup.tsx`, `PhysiquePhotos.tsx`, and the Google Health card/chart. | Inventory semantics first; extend shared button variants for links/rows/choices where needed, then migrate feature actions. Native buttons inside shared widgets are legitimate implementation details. | Keyboard/focus and pointer hit-testing pass; selection/row semantics remain intact at 390/768/1440 in both themes. |
| 1 | `LogFood.tsx` is 689 lines and `Coach.tsx` 610: selection/review and coaching coordination live in large UI modules. | Extract food-method/draft coordination into hooks and existing review surfaces; split Coach by check-in/history/accepted-plan responsibilities. Reuse FoodPicker rather than introducing another search component. | Focused tests preserve serving unknowns, retained drafts/conflicts, logging choices, and acceptance revisions; browser flows remain unchanged. |
| 2 | `web/src/index.css` is 1,361 lines with many dense rules; motion values are also literal in `ui/Motion.tsx` (240/180 ms) alongside CSS variables. | First format CSS without semantic changes; then separate foundation/shared/feature styles with preserved import/cascade order. Give JS and CSS motion one source of timing/easing. | Build and existing visual tests pass in both themes and reduced motion; no cascade/order regression. |
| 2 | Package scripts have typecheck/test/build but no lint/format/design-system/dead-code gates; CI does not check guidance equality or run browser suites. | Introduce scoped readability/reuse checks and byte-equality checks for CLAUDE/AGENTS. Baseline existing violations explicitly; reject new violations. Add isolated browser CI after runtime/dependency setup is reliable. | A mismatched documentation pair or new feature raw button fails the gate; existing primitives are allowed; CI runs the responsive/theme checks. |

## Delivery approach

1. Capture focused behavior/browser coverage before refactoring each surface; do not approve broad snapshot replacement as a fix.
2. Deliver shared-action migration, UI decomposition, styling/motion cleanup, and automated gates as separate reviewable changes. Avoid unrelated domain changes.
3. Run the affected full checks from `CLAUDE.md`; keep provider calls and personal data out of test environments. No commit, deployment, or refactor is authorized by this plan alone.

The existing shared controls, detailed UI design documents, semantic tokens, and reduced-motion handling are foundations to extend. This review found consistency/enforcement gaps; it did not establish a general color or accessibility failure. Live UI, provider behavior, and production were not exercised.
