# Nutrition App

A separate two-user, mobile-first nutrition PWA. React/TypeScript/Vite frontend, ASP.NET Core 10 API, PostgreSQL on Neon, Vercel hosting for the PWA and Cloud Run hosting for the API. FinancialApp is not a runtime dependency.

## Local development

Requirements: Node 24 and .NET 10. run `npm.cmd install` and `npm.cmd run build` inside `web`, then copy `web/dist/` into `api/wwwroot/` or run `scripts/build.ps1`. Start `scripts/run-local.ps1` and open http://127.0.0.1:5088. Development defaults to an isolated local SQLite database. Production requires a PostgreSQL connection string and applied migrations.

## Android app

The Android app uses Capacitor 8 (`com.nutritionapp.mobile`) and packages the built web interface in the APK. API requests use the production Nutrition origin so the existing session cookie and Vercel API proxy continue to work. From `web/`, run `npm.cmd run android:sync` after web changes, then `npm.cmd run android:open` to open the project in Android Studio. Connect an Android phone with USB debugging enabled and use Run, or build a debug APK with `cd android; .\gradlew.bat assembleDebug`; the APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

Building requires Android Studio, its Android SDK (API 36), and JDK 21. `android:run` also requires a connected device or configured emulator. This workspace currently has no Android SDK or JDK, so the native Gradle build and phone installation still need to be checked there. Camera scanning requests Android's camera permission. Hardware Back dismisses the active Nutrition dialog and exits from the main screen.

Fitness Account sign-in remains a web authorization flow. Google Health consent must be completed in the browser/PWA because Google blocks OAuth in embedded WebViews; an Android browser session cannot reuse the app WebView's Nutrition cookie. Weekly coaching reminders can use browser/PWA Web Push or native Android FCM. Each device subscribes separately; the account reminder schedule remains in Settings. Android builds require the Nutrition Firebase app configuration for `com.nutritionapp.mobile` and must pass `npm.cmd run check:android-firebase` before Capacitor sync.

For Vite hot reload, run the API on port 5088 with `PublicOrigin=http://127.0.0.1:5178`, then run `npm.cmd run dev` inside `web`. Use the Vite URL. Accounts are provisioned via central Fitness Account OIDC (`openid`, `profile`), capped at two users; no credentials or passwords are stored in NutritionApp.

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
- Auth uses central Fitness Account OIDC (`openid`, `profile`) with hashed database sessions in HttpOnly same-site cookies (`nutrition-session`). Unsafe endpoints require an exact Origin and custom request header; API responses are never cached by the service worker.
- Offline diary edits are account-scoped IndexedDB records, persisted before dispatch. Requests are idempotent; conflicts stop the queue for review. Sign-out retains unsynced work.
- AI requests are processed as temporary server jobs; successful best-effort estimates go directly into the editable batch. Uploaded scan images are re-encoded without EXIF, private, and deleted after processing, with scheduler cleanup for interrupted jobs.
- PostgreSQL tenancy filters fail closed and writes validate ownership. Registration slots and advisory transactions serialize competing writes.
- Detailed meals are kept for 90 calendar days by default (`Retention:MealDetailDays`, 3–90). The authenticated scheduler atomically saves daily totals/completeness, then deletes old entries. Daily summaries, weights and accepted plans remain. Old meal-detail edits are rejected with the local draft preserved. Mutation receipts expire after 90 days.
- Bootstrap reads a bounded 90-day window; explicit year browsing reads one year. Full-history reads are explicit exports.
- Food has a compact daily timeline beginning at 12 AM, with editable profile-local meal times and a separate group for legacy entries without recorded times. Older dates show daily summaries; increasing retention cannot restore deleted details or reopen archived meals.
- Log Food offers calorie-only Quick Add (time prefilled, unknown macros left null) and full Manual entry. Both use the retained offline queue. Downloaded history is account-scoped and bounded to 16 cached windows, independently of the mutation queue and image drafts.
- Food search reads Open Food Facts through Search-a-licious (`search.openfoodfacts.org`); barcode lookup and search-serving hydration read the product API (`world.openfoodfacts.org/api/v2`). The legacy `cgi/search.pl` endpoint sheds load per IP and every call leaves from one egress address, so its failures were app-wide. Search results are hydrated in bulk with declared gram-based servings and serving calories when available. Review starts at that serving, otherwise 100 g. Serving weights can be entered manually; unknown weights never imply a scoop size or a millilitre-to-gram conversion.
- Physique photos use private Google Cloud Storage through ADC, with nutrition-specific immutable paths and authenticated image responses. The browser persists drafts before upload and compresses to at most 750 KB / 1600 px. Only metadata is stored in PostgreSQL.
- Google Health steps remain read-only, runtime-memory-only display data and never affect nutrition calculations. Optional weight sync is one-way and disabled by default: after the user grants `googlehealth.health_metrics_and_measurements.writeonly`, only weights first accepted while enabled are queued; recorded scale kilograms are uploaded as grams at noon in the profile time-zone offset, and later edits/deletions mirror the mapped Google copy. Existing history is excluded, disabled-period edits are not replayed, Google copies survive disconnect, and failed or unknown uploads remain visible for explicit recovery. Local weights, trends, and coaching remain authoritative.

See [methodology](web/src/components/Methodology.tsx), [deployment/recovery](deploy/README.md), and [verification status](VERIFICATION.md). This is a research-informed provisional estimator, not clinical validation or a reproduction of MacroFactor's proprietary algorithm.

The UI contract and extension checklist live in [UI/UX design principles](docs/UI_UX_DESIGN_PRINCIPLES.md) and [UI/UX extension checklist](docs/UI_UX_EXTENSION_CHECKLIST.md). Future screens and interactions must update those instructions and their focused/browser tests together.


## First-login setup

Authentication delegates to central Fitness Account. Accounts without a saved profile open the setup form automatically, including when they return after leaving setup unfinished. Age, height, weight, equation sex parameter, activity and goal start blank and require explicit answers. Resistance training and coaching population boundaries are reviewed in the same form. After the profile syncs, the backend automatically returns a starting proposal; the user must accept it. A known maintenance estimate can replace the equation-based starting expenditure. Saved profiles remain editable in Coach.

## Adaptive phases and user-selected pace

Version 1.1.0 supports fat loss, bulking and maintenance. The user chooses an energy-adjustment percentage, an ongoing phase, a duration (1–104 weeks), or a target weight. Duration measures elapsed phase time; target-weight percentage measures change from starting weight using the calculated trend. At completion the engine proposes maintenance, requiring acceptance. Completion is latched in accepted programs until the user changes the profile/phase.

The UI starts with a 15% deficit or 5% surplus. It identifies 10–20% deficits and 5–10% surpluses as conservative starting bands, and warns above those bands. These are product ranges informed by limited athlete/lifter research, not published universal thresholds. Lower percentages are described as gentler. The server caps selected deficits at 25% and surpluses at 20%; calorie floors and ordinary weekly adjustment bounds still apply. This replaces the original fixed-rate starting defaults for profiles configured through the new slider. Older profiles without a selected percentage retain their original rate-based default until edited.

Weight-goal finish estimates come from observed robust weight-change slopes, requiring at least six recent weigh-ins spanning 14 days, with a fresh observation. They do not extrapolate the 7,700 kcal/kg approximation to a long-term goal date. Flat, reversed, insufficient or stale observations suppress the date; forecasts beyond two years are withheld. Forecasts are conditional and can change substantially. Smoothing is time-aware exponential weighting with a seven-day half-life, supported as a statistical method by NIST; that half-life is a product choice, not a best-in-class biological formula.

When a new weigh-in differs from the median of at least three entries in the prior 14 days by more than the greater of 1 kg or 1.5% of that median, the form optionally asks whether a temporary factor may be involved. The selected context is stored with the weigh-in. Stress, bloating/water retention, menstrual cycle, illness, travel, or another temporary factor excludes that point from expenditure and suggested-calorie weight trends; unsure, genuine change, or no answer continues through the existing statistical filter. The scale value stays in weight history and charts, and coaching explains when user-marked weigh-ins were excluded. Context never applies a calorie adjustment, and limited remaining weigh-ins hold recalibration under the existing evidence rules.

Weight charts toggle daily observations, calculated trend, or both, with an accessible data table. An additional chart shows accepted maintenance estimates. The estimate is total daily expenditure inferred from logs, not a measured resting metabolic rate. Learned expenditure carries between phases; explicitly changed activity scales it, and changing a manual maintenance estimate replaces it. A phase edit cannot repeatedly blend the same week's observations.

## Energy-balance history

Progress contains intake/maintenance bars and signed energy-balance bars. Weight has its own recent-90-days/calendar-year selector. Energy ranges are 7, 28, 90 days or a calendar year; bars group by day, calendar week or month. History views have independent account-scoped caches and do not replace the main diary window. The comparison uses accepted, effective-dated maintenance estimates, including the accepted estimate preceding the displayed window. New coaching estimates do not retroactively replace older dates.

Positive balance means intake above estimated maintenance; negative means below. Incomplete/missing intake or unavailable historical maintenance produces an unknown balance, never an invented deficit. Aggregated net balance requires every included day to be known; an additional subtotal explicitly reports only fully logged days. Confirmed fasting is an explicit zero. Compacted daily summaries feed the same chart, and the chart does not create additional stored history.


## Form validation and barcode framing

Forms use the shared application validation layer (`Form` and `FieldFrame`): inline errors appear after leaving a control or submitting, update during correction, and focus the first invalid visible control. Custom dates and selects focus their trigger without opening the popup. Native browser validation bubbles are disabled; server validation remains authoritative. New forms should use these shared components, including actions that retain offline drafts.

The barcode camera decodes only the pixels inside the displayed frame, accounting for centered video cropping and viewport resizing. A successful detection fills the barcode field for one lookup and stops the camera. Manual barcode entry remains available if camera access fails.

Dashboard shows current-day energy, macros, coaching actions, and a compact trend-weight summary. Browse dates, edit meal entries, and copy days in Food Log. Food batches use compact rows with aligned energy and desktop actions; on mobile, swipe left or open the visible row menu to edit or remove a food. A compact batch button sits beside the Log food title. Fibre remains stored and editable but is omitted from compact previews. Search inputs reset when switching logging methods or returning to selection. Successful AI estimates enter the batch as editable best-effort lines and clear the description/photo input; logging the batch explicitly saves them. Recipes combine API-search or saved-food ingredients, gram quantities, cooked yield, and servings into one saved food while preserving unknown nutrients.
