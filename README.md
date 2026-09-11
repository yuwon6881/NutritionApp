# Nutrition App

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

- Phones below 640 px use five bottom navigation items with Add centered and Settings in the account header. Tablets from 640 to 1023 px use a compact side rail; wider screens use the labeled sidebar. Chart drawing widths follow their containers so axis labels remain readable. Calendar popovers stay within the viewport and return focus when dismissed with Escape.
- Server-owned coaching is versioned. Preview/accept verifies the input revision and weekly cadence; accepted history is immutable.
- Coach setup uses directional step transitions and selectable goal cards. Local estimates update immediately; calculation, retained synchronization, acceptance, and view-refresh feedback follow actual operations. Reduced motion disables movement and looping indicators. Stale previews are ignored, and an uncertain acceptance retries its original identity and input revision.
- Today stays open in the profile time zone; past days with food complete automatically. Missing days prompt for fasting or not logging. Not logging preserves weight-based trends and coaching estimates without inventing calorie intake. Nutrients are immutable entry snapshots, with absent values remaining absent.
- Auth uses hashed database sessions in HttpOnly same-site cookies. Unsafe endpoints require an exact Origin and custom request header; API responses are never cached by the service worker.
- Offline queue and scan drafts are account-scoped IndexedDB records, persisted before dispatch. Requests are idempotent; conflicts stop the queue for review. Sign-out retains unsynced work.
- Food-scan drafts are re-encoded on the client without EXIF. Scan images are private and temporary, with durable object paths retained until deletion succeeds. Scheduler cleanup handles idle Cloud Run.
- PostgreSQL tenancy filters fail closed and writes validate ownership. Registration slots and advisory transactions serialize competing writes.
- Detailed meals are kept for 90 calendar days by default (`Retention:MealDetailDays`, 3–90). The authenticated scheduler atomically saves daily totals/completeness, then deletes old entries. Daily summaries, weights and accepted plans remain. Old meal-detail edits are rejected with the local draft preserved. Mutation receipts expire after 90 days.
- Bootstrap reads a bounded 90-day window; explicit year browsing reads one year. Full-history reads are explicit exports.
- Food has a compact daily timeline beginning at 12 AM, with editable profile-local meal times and a separate group for legacy entries without recorded times. Older dates show daily summaries; increasing retention cannot restore deleted details or reopen archived meals.
- Log Food offers calorie-only Quick Add (time prefilled, unknown macros left null) and full Manual entry. Both use the retained offline queue. Downloaded history is account-scoped and bounded to 16 cached windows, independently of the mutation queue and image drafts.
- Food search reads Open Food Facts through Search-a-licious (`search.openfoodfacts.org`); barcode lookup reads the product endpoint (`world.openfoodfacts.org/api/v2`). The legacy `cgi/search.pl` endpoint sheds load per IP and every call leaves from one egress address, so its failures were app-wide. The search index carries no declared serving: a search hit offers grams or an unweighed serving, while a scanned barcode can also offer its declared portion.
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

Progress contains intake/maintenance bars and signed energy-balance bars. Weight has its own recent-90-days/calendar-year selector. Energy ranges are 7, 28, 90 days or a calendar year; bars group by day, calendar week or month. History views have independent account-scoped caches and do not replace the main diary window. The comparison uses accepted, effective-dated maintenance estimates, including the accepted estimate preceding the displayed window. New coaching estimates do not retroactively replace older dates.

Positive balance means intake above estimated maintenance; negative means below. Incomplete/missing intake or unavailable historical maintenance produces an unknown balance, never an invented deficit. Aggregated net balance requires every included day to be known; an additional subtotal explicitly reports only fully logged days. Confirmed fasting is an explicit zero. Compacted daily summaries feed the same chart, and the chart does not create additional stored history.


## Form validation and barcode framing

Forms use the shared application validation layer (`Form` and `FieldFrame`): inline errors appear after leaving a control or submitting, update during correction, and focus the first invalid visible control. Custom dates and selects focus their trigger without opening the popup. Native browser validation bubbles are disabled; server validation remains authoritative. New forms should use these shared components, including actions that retain offline drafts.

The barcode camera decodes only the pixels inside the displayed frame, accounting for centered video cropping and viewport resizing. Successful detection fills the barcode field for a separate lookup in single-shot mode, or enqueues the code with a per-code cooldown in continuous batch mode. Camera streams continue scanning in continuous batch mode until manually stopped, switching logging tabs, or closing the dialog; in single-shot mode, the stream stops immediately upon detection, manual stop, changing logging methods, or closing the dialog. Manual barcode entry remains available if camera access fails.
