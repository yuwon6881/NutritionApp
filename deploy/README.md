# Deployment and recovery

The nutrition app uses an independent Neon PostgreSQL database, a Vercel PWA, and a Cloud Run API in Singapore. The FinancialApp service and database are independent.

## Database and secrets

The API accepts a PostgreSQL URL or an Npgsql connection string in `ConnectionStrings__Database`. Neon URLs are normalized with verified TLS, required channel binding, and a maximum local pool size of 10. Runtime uses the supplied `-pooler` hostname. Migrations use its direct counterpart without `-pooler`.

Production uses the `NutritionApp` Neon project (`weathered-base-36414862`) and its `nutrition` database. The provider-created `neondb` database and the historic `fitness_account` database in that project were removed on 2026-09-17 after ownership verification, encrypted backups, and the controlled data merge. Only `nutrition` remains as the application database; keep the encrypted backups outside Neon for the retention period.

Store the connection, `OpenAi__ApiKey`, and `Cleanup__Token` in Google Secret Manager. No secret belongs in Vite variables or source control. The ignored `deploy/neon.local.json` is only for local provisioning; it is excluded from Git and Docker contexts. The previously supplied Neon project ID was discarded.

`dotnet run --project tools/DatabaseAdmin/DatabaseAdmin.csproj -- inspect deploy/neon.local.json` reads tables and size. The `migrate` command refuses unexpected public tables before applying EF migrations. `neon deploy` manages Neon infrastructure configuration; it does not replace the ASP.NET EF schema migrations. No Neon Auth, Neon Functions, or Neon object storage are needed by this application.

The controlled legacy consolidation used `legacy-compare` as a read-only preflight followed by an explicit `legacy-merge ... --map-single-user --apply` transaction. Credentials, sessions, receipts, scans, usage counters, derived estimates, caches, and photo rows were intentionally excluded.

Neon Free currently includes 0.5 GB storage per project. The 350 MB warning and 400 MB optional-write limit are configurable application defaults (`Storage:DatabaseWarningBytes` and `Storage:DatabaseBlockBytes`), not provider quota telemetry; monitor branch/history overhead and Neon compute quotas in its console. Optional scan-image capacity is configurable through `Storage:TemporaryImageBytes`. Meal details now default to 90 calendar days before compaction, and each authenticated maintenance request is bounded by `Maintenance:MaxSeconds` (45 seconds by default). [Neon pricing](https://neon.com/pricing).

The API emits low-cardinality OpenTelemetry-compatible meters for route requests, database command kind/duration, and outbound provider calls. Provider labels are limited to OpenAI, GCS/Google, Open Food Facts, Fitness Account, Workout, and other; SQL text, URLs, account IDs, source text, images, and tokens are never metric labels. Connect these meters to the production exporter before using them for a cost baseline.

Food search and barcode lookup both read Open Food Facts, which needs no key and no secret. It meters per IP address rather than per caller: 10 search requests a minute and 15 product reads a minute, counted separately, which the service paces with its own gates. Reads must identify the caller through the User-Agent set on the shared HttpClient, or Open Food Facts may answer as though the request came from a bot. The search endpoint sheds load under pressure, so a 503 there is a wait, not a misconfiguration. Results carry ODbL attribution in each row Source.

## API and files

Build the API-only Dockerfile using Cloud Build. Deploy a new Cloud Run service with `Auth__MaxUsers=2`, `OpenAi__Model=gpt-5.4-mini`, `Database__MigrateOnStartup=true`, `Retention__MealDetailDays=90`, minimum instances 0 and maximum instances 1. The API applies pending EF migrations over the direct database connection before it begins serving traffic, so every migration must include its EF migration metadata and appear in `dotnet ef migrations list`. Keep the controlled DatabaseAdmin path for inspection and recovery. `PublicOrigin` must be the exact Vercel production HTTPS origin, without a trailing slash. Review memory and request timeouts against actual workloads.

Google Health uses the production OAuth web client configured in the Cloud project. Keep its client ID in the `_GOOGLE_HEALTH_CLIENT_ID` Cloud Build substitution and its client secret in Secret Manager as `google-health-client-secret`; the secret is injected only into the runtime service. The authorized redirect URI is `https://nutrition-diary-app.vercel.app/api/integrations/google-health/callback`. The external consent screen remains in testing until Google verification is completed, so add approved test accounts in Google Auth Platform before testing the connection.

`Physique__Bucket` selects the existing private GCS bucket. Grant the nutrition runtime identity access only to the `nutrition-physique/` prefix. Keep FinancialApp bucket policies unchanged. Its versioning/30-day soft-delete policy applies to physique photos; deletion targets the exact generation.

`ScanStorage__Bucket` selects a separate private temporary GCS bucket. Use uniform access, public-access prevention, no versioning, and an explicit short retention policy suitable for disposable scans. Uploaded objects are under `nutrition-scans/`. Delete scans immediately after processing and abandoned uploads after 24 hours. A bucket lifecycle rule is an additional fallback, not an exact-time deletion guarantee. Physique photos must never share the temporary bucket's lifecycle.

Configure an hourly Cloud Scheduler POST directly to the API `/internal/cleanup`, supplying its protected `X-Cleanup-Token`. Scheduler wakes Cloud Run independently of the PWA. Alert on failures. The endpoint runs scan cleanup, atomic diary compaction and pending physique deletion retries.

Optional Google Health weight uploads use a separate minute-level Cloud Scheduler POST to `/internal/google-health-weight-sync`, authenticated with the same protected header. Run `deploy/setup-google-health-weight-sync.ps1` with `-ApiOrigin` and a token supplied from Secret Manager or `NUTRITION_CLEANUP_TOKEN`; the script creates or updates the dedicated job idempotently. Each invocation processes at most 25 due records or 45 seconds, so durable leases leave remaining work for the next minute. The OAuth web client must have the health-metrics write scope approved before live testing.

Nutrition weekly check-in reminders use shared Firebase project `project-7eb1aec8-8636-4c86-b2a`. Nutrition owns its device subscriptions, account schedule, sender and scheduler job; FinancialApp's client configuration and backend registrations are not reused. The Cloud Build substitution `_NUTRITION_FCM_PROJECT_ID` targets the shared Firebase project. Grant the Nutrition Cloud Run service account the Firebase Cloud Messaging API Admin role in that project before enabling dispatch.

For web and installed PWA builds, set the matching public Vercel variables `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, and the shared `VITE_FIREBASE_VAPID_KEY`, then make a new deployment. These values are embedded in the browser bundle and are not server credentials. The deployed web app, FCM sender, and VAPID key must all reference the shared Firebase project.

For Android, register the separate Firebase app with package `com.nutritionapp.mobile` and place its `google-services.json` in `web/android/app/`. Never copy FinancialApp's file, because it contains only FinancialApp's Android package. `npm.cmd run check:android-firebase` verifies the Firebase project and Android package before `npm.cmd run android:sync`. The app uses the native FCM token and Android notification permission flow; it does not use browser notification permission or the service worker for native registration.

Run `deploy/setup-nutrition-check-in-push.ps1` with `-ApiOrigin` and the protected scheduler token to create or update Nutrition's five-minute dispatch job. Users opt in per device and separately choose one weekly weekday, time, and IANA time zone. Notification text is always generic; disabling the schedule stops reminders, while disabling a device subscription revokes only its matching token. The server only sends within 30 minutes of the selected local time and does not replay missed days. Each device/date delivery is deduplicated, and notification taps accept only the `/coach` route.

## Vercel

Deploy the `web` directory as a Vite project. The Vercel routing configuration proxies `/api/*` to the new Cloud Run service, keeping requests and HttpOnly cookies on the PWA origin. This avoids reliance on third-party cookies on iPhone. Never enable CDN caching for authenticated API responses. `/internal/*` is not a frontend route. Unknown asset URLs must return 404 rather than the SPA document.

Set the exact backend origin in the checked routing configuration before deployment. Verify Secure/HttpOnly/SameSite cookies, retained Origin headers, private responses, PWA installation, asset MIME types, and large photo requests through the deployed proxy. [Vercel external rewrites](https://vercel.com/docs/routing/rewrites).

## Backup and restore

An authenticated JSON export is not a disaster-recovery backup. Use `pg_dump --format=custom --no-owner` against the direct Neon endpoint with credentials injected securely. Store encrypted logical backups outside Neon, with a separate retention/budget policy. Restore into an isolated empty database using `pg_restore --no-owner`, then verify counts, login, accepted programs and user isolation. Never use the live database for a restore test. Neon time-travel retention is finite and does not replace these backups.

The migrations enable row-level security with no browser policies. The backend database role owns the tables; its application query filters and write ownership checks remain mandatory. Database credentials never reach the browser.
