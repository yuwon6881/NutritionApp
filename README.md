# Nourish

A separate two-user, mobile-first nutrition PWA. React/TypeScript/Vite frontend, ASP.NET Core 10 API, PostgreSQL on Neon, Vercel hosting for the PWA and Cloud Run hosting for the API. FinancialApp is not a runtime dependency.

## Local development

Requirements: Node 24 and .NET 10. run `npm.cmd install` and `npm.cmd run build` inside `web`, then copy `web/dist/` into `api/wwwroot/` or run `scripts/build.ps1`. Start `scripts/run-local.ps1` and open http://127.0.0.1:5088. Development defaults to an isolated local SQLite database. Production requires a PostgreSQL connection string and applied migrations.

For Vite hot reload, run the API on port 5088 with `PublicOrigin=http://127.0.0.1:5178`, then run `npm.cmd run dev` inside `web`. Use the Vite URL. Registration supports two accounts; use a password of at least 12 characters.

Optional development configuration goes in ignored `api/appsettings.Local.json` or environment variables. See [deployment configuration](deploy/README.md). The UI remains fully useful without food-provider or OpenAI credentials: manual food/recipe logging, weight tracking, and deterministic coaching need no external AI.

## Checks

```powershell
dotnet test tests/Nutrition.Tests.csproj
cd web
npm run typecheck
npm test
npm run build
npm run test:visual
```

The browser suite targets a dedicated local test API at `http://127.0.0.1:5088`. Never point tests at production. Test state is private to a local development database.

## Contracts

- Server-owned coaching is versioned. Preview/accept verifies the input revision and weekly cadence; accepted history is immutable.
- Today stays open in the profile time zone; past days with food complete automatically. Missing days prompt for fasting or not logging. Not logging preserves weight-based trends and coaching estimates without inventing calorie intake. Nutrients are immutable entry snapshots, with absent values remaining absent.
- Auth uses hashed database sessions in HttpOnly same-site cookies. Unsafe endpoints require an exact Origin and custom request header; API responses are never cached by the service worker.
- Offline queue and scan drafts are account-scoped IndexedDB records, persisted before dispatch. Requests are idempotent; conflicts stop the queue for review. Sign-out retains unsynced work; explicit wipe removes it.
- Food-scan drafts are re-encoded on the client without EXIF. Scan images are private and temporary, with durable object paths retained until deletion succeeds. Scheduler cleanup handles idle Cloud Run.
- PostgreSQL tenancy filters fail closed and writes validate ownership. Registration slots and advisory transactions serialize competing writes.
- Detailed meals are kept for seven calendar days by default (`Retention:MealDetailDays`, 3–90). The authenticated scheduler atomically saves daily totals/completeness, then deletes old entries. Daily summaries, weights and accepted plans remain. Old meal-detail edits are rejected with the local draft preserved. Mutation receipts expire after 90 days.
- Bootstrap reads a bounded 90-day window; explicit year browsing reads one year. Full-history reads are explicit exports.
- Physique photos use private Google Cloud Storage through ADC, with nutrition-specific immutable paths and authenticated image responses. The browser persists drafts before upload and compresses to at most 750 KB / 1600 px. Only metadata is stored in PostgreSQL.

See [methodology](web/src/components/Methodology.tsx), [deployment/recovery](deploy/README.md), and [verification status](VERIFICATION.md). This is a research-informed provisional estimator, not clinical validation or a reproduction of MacroFactor's proprietary algorithm.


## First-login setup

Registration and login are built in. Accounts without a saved profile open the setup form automatically, including when they return after leaving setup unfinished. Age, height, weight, equation sex parameter, activity and goal start blank and require explicit answers. Resistance training and coaching population boundaries are reviewed in the same form. After the profile syncs, the backend automatically returns a starting proposal; the user must accept it. A known maintenance estimate can replace the equation-based starting expenditure. Saved profiles remain editable in Coach.

## Adaptive phases and user-selected pace

Version 1.1.0 supports fat loss, bulking and maintenance. The user chooses an energy-adjustment percentage, an ongoing phase, a duration (1–104 weeks), or a target weight. Duration measures elapsed phase time; target-weight percentage measures change from starting weight using the calculated trend. At completion the engine proposes maintenance, requiring acceptance. Completion is latched in accepted programs until the user changes the profile/phase.

The UI starts with a 15% deficit or 5% surplus. It identifies 10–20% deficits and 5–10% surpluses as conservative starting bands, and warns above those bands. These are product ranges informed by limited athlete/lifter research, not published universal thresholds. Lower percentages are described as gentler. The server caps selected deficits at 25% and surpluses at 20%; calorie floors and ordinary weekly adjustment bounds still apply. This replaces the original fixed-rate starting defaults for profiles configured through the new slider. Older profiles without a selected percentage retain their original rate-based default until edited.

Weight-goal finish estimates come from observed robust weight-change slopes, requiring at least six recent weigh-ins spanning 14 days, with a fresh observation. They do not extrapolate the 7,700 kcal/kg approximation to a long-term goal date. Flat, reversed, insufficient or stale observations suppress the date; forecasts beyond two years are withheld. Forecasts are conditional and can change substantially. Smoothing is time-aware exponential weighting with a seven-day half-life, supported as a statistical method by NIST; that half-life is a product choice, not a best-in-class biological formula.

Weight charts toggle daily observations, calculated trend, or both, with an accessible data table. An additional chart shows accepted maintenance estimates. The estimate is total daily expenditure inferred from logs, not a measured resting metabolic rate. Learned expenditure carries between phases; explicitly changed activity scales it, and changing a manual maintenance estimate replaces it. A phase edit cannot repeatedly blend the same week's observations.

## Energy-balance history

Progress contains intake/maintenance bars and signed energy-balance bars. Ranges are 7, 28, 90 days or the selected history window; bars group by day, calendar week or month. The comparison uses accepted, effective-dated maintenance estimates, including the accepted estimate preceding the displayed window. New coaching estimates do not retroactively replace older dates.

Positive balance means intake above estimated maintenance; negative means below. Incomplete/missing intake or unavailable historical maintenance produces an unknown balance, never an invented deficit. Aggregated net balance requires every included day to be known; an additional subtotal explicitly reports only fully logged days. Confirmed fasting is an explicit zero. Compacted daily summaries feed the same chart, and the chart does not create additional stored history.

