# Nourish application guidance

This repository is independent of FinancialApp. These rules apply to NutritionApp and override FinancialApp-specific guidance from the parent directory. Keep AGENTS.md and CLAUDE.md identical when editing them.

## Product and interface

- Keep the interface clean, restrained, premium, and data driven. Remove slogans, motivational copy, redundant introductions, and decorative descriptions. Labels, units, dates, data provenance, uncertainty, errors, and actionable instructions belong in the UI.
- Use bundled Inter Variable throughout, including forms and chart labels. Use tabular numerals for numerical comparisons. Keep typography in web/src/index.css; no feature-specific font families or remote font requests.
- Preserve the established Ayu light and dark semantic color tokens. Reuse components in web/src/components/ui for buttons, fields, dates, selects, and panels. Do not create parallel color or component systems.
- Maintain keyboard focus, accessible labels, reduced-motion support, and 44 px touch controls on compact and medium screens. Verify layout at 390, 768, and 1440 px in both themes.
- Open a returning account from its local cache before waiting for session validation or a server wake-up. Keep food and weight entry available during network delays, bound requests with timeouts, and retry retained edits on reconnect/foreground wake. Ignore stale refresh responses. First use still requires online sign-in.
- Ordinary saves happen automatically. Show retained pending work or actionable errors, without a routine sync button or idle refresh animation.

## Data contracts

- Today remains open in the profile time zone. Past dates with food automatically count as complete. Missing intake requires a fasting/not-logging decision; never infer fasting or zero from absent calories.
- Not logging preserves weights, trend calculations, and provisional/accepted coaching estimates. Missing calories cannot identify expenditure from weight change alone, so hold adaptive intake-based recalibration until its evidence requirements are met.
- Keep day resolution consistent across coaching, charts, offline projection, and retained summaries. Day decisions may change on archived dates; archived nutrient totals must survive such changes. Old meal details remain read-only.
- AI supports descriptions, meal photos, and nutrition-label photos. Returned fields remain editable drafts. Preserve unknown nutrients and quantity basis; never auto-submit scans or claim verified accuracy.
- Persist account-scoped mutations and image drafts before dispatch. Preserve idempotency, conflict review, tenancy, and private image cleanup. Never reset or discard unsynced work to hide failures.
- Server coaching remains authoritative. Accepted plans are immutable and revision checked. Do not change physiological equations or adaptation thresholds as a UI cleanup.

## Working and verification

- Inspect git status and preserve concurrent edits. Do not commit, push, or deploy unless requested.
- Frontend: web/ (React, TypeScript, Vite); API: api/ (.NET); regressions: tests/ and web/e2e/.
- Run dotnet test tests/Nutrition.Tests.csproj, then in web run npm.cmd run typecheck, npm.cmd test, npm.cmd run build. For UI changes also run npm.cmd run test:visual against an isolated local API.
- Browser tests reset local test accounts. Never run them against production or a personal diary database. Use an isolated Data Source with the development API.
- Document any unavailable live-provider or deployment checks honestly. Keep documentation aligned with the implemented contracts.
