# Deployment and recovery

The nutrition app uses an independent Neon PostgreSQL database, a Vercel PWA, and a Cloud Run API in Singapore. The FinancialApp service and database are independent.

## Database and secrets

The API accepts a PostgreSQL URL or an Npgsql connection string in `ConnectionStrings__Database`. Neon URLs are normalized with verified TLS, required channel binding, and a maximum local pool size of 10. Runtime uses the supplied `-pooler` hostname. Migrations use its direct counterpart without `-pooler`.

Production uses the `NutritionApp` Neon project (`weathered-base-36414862`) and its `nutrition` database. The provider-created `neondb` database and the historic `fitness_account` database in that project were removed on 2026-09-17 after ownership verification, encrypted backups, and the controlled data merge. Only `nutrition` remains as the application database; keep the encrypted backups outside Neon for the retention period.

Store the connection, `OpenAi__ApiKey`, and `Cleanup__Token` in Google Secret Manager. No secret belongs in Vite variables or source control. The ignored `deploy/neon.local.json` is only for local provisioning; it is excluded from Git and Docker contexts. The previously supplied Neon project ID was discarded.

`dotnet run --project tools/DatabaseAdmin/DatabaseAdmin.csproj -- inspect deploy/neon.local.json` reads tables and size. The `migrate` command refuses unexpected public tables before applying EF migrations. `neon deploy` manages Neon infrastructure configuration; it does not replace the ASP.NET EF schema migrations. No Neon Auth, Neon Functions, or Neon object storage are needed by this application.

The controlled legacy consolidation used `legacy-compare` as a read-only preflight followed by an explicit `legacy-merge ... --map-single-user --apply` transaction. Credentials, sessions, receipts, scans, usage counters, derived estimates, caches, and photo rows were intentionally excluded.

Neon Free currently includes 0.5 GB storage per project. The 350 MB warning and 400 MB optional-write limit are application budgets, not provider quota telemetry; monitor branch/history overhead and Neon compute quotas in its console. Meal details now default to 90 calendar days before compaction. [Neon pricing](https://neon.com/pricing).

Food search and barcode lookup both read Open Food Facts, which needs no key and no secret. It meters per IP address rather than per caller: 10 search requests a minute and 15 product reads a minute, counted separately, which the service paces with its own gates. Reads must identify the caller through the User-Agent set on the shared HttpClient, or Open Food Facts may answer as though the request came from a bot. The search endpoint sheds load under pressure, so a 503 there is a wait, not a misconfiguration. Results carry ODbL attribution in each row Source.

## API and files

Build the API-only Dockerfile using Cloud Build. Deploy a new Cloud Run service with `Auth__MaxUsers=2`, `OpenAi__Model=gpt-5.4-mini`, `Database__MigrateOnStartup=true`, `Retention__MealDetailDays=90`, minimum instances 0 and maximum instances 1. The API applies pending EF migrations over the direct database connection before it begins serving traffic, so every migration must include its EF migration metadata and appear in `dotnet ef migrations list`. Keep the controlled DatabaseAdmin path for inspection and recovery. `PublicOrigin` must be the exact Vercel production HTTPS origin, without a trailing slash. Review memory and request timeouts against actual workloads.

Google Health uses the production OAuth web client configured in the Cloud project. Keep its client ID in the `_GOOGLE_HEALTH_CLIENT_ID` Cloud Build substitution and its client secret in Secret Manager as `google-health-client-secret`; the secret is injected only into the runtime service. The authorized redirect URI is `https://nutrition-diary-app.vercel.app/api/integrations/google-health/callback`. The external consent screen remains in testing until Google verification is completed, so add approved test accounts in Google Auth Platform before testing the connection.

`Physique__Bucket` selects the existing private GCS bucket. Grant the nutrition runtime identity access only to the `nutrition-physique/` prefix. Keep FinancialApp bucket policies unchanged. Its versioning/30-day soft-delete policy applies to physique photos; deletion targets the exact generation.

`ScanStorage__Bucket` selects a separate private temporary GCS bucket. Use uniform access, public-access prevention, no versioning, and an explicit short retention policy suitable for disposable scans. Uploaded objects are under `nutrition-scans/`. Delete scans immediately after processing and abandoned uploads after 24 hours. A bucket lifecycle rule is an additional fallback, not an exact-time deletion guarantee. Physique photos must never share the temporary bucket's lifecycle.

Configure an hourly Cloud Scheduler POST directly to the API `/internal/cleanup`, supplying its protected `X-Cleanup-Token`. Scheduler wakes Cloud Run independently of the PWA. Alert on failures. The endpoint runs scan cleanup, atomic diary compaction and pending physique deletion retries.

## Vercel

Deploy the `web` directory as a Vite project. The Vercel routing configuration proxies `/api/*` to the new Cloud Run service, keeping requests and HttpOnly cookies on the PWA origin. This avoids reliance on third-party cookies on iPhone. Never enable CDN caching for authenticated API responses. `/internal/*` is not a frontend route. Unknown asset URLs must return 404 rather than the SPA document.

Set the exact backend origin in the checked routing configuration before deployment. Verify Secure/HttpOnly/SameSite cookies, retained Origin headers, private responses, PWA installation, asset MIME types, and large photo requests through the deployed proxy. [Vercel external rewrites](https://vercel.com/docs/routing/rewrites).

## Backup and restore

An authenticated JSON export is not a disaster-recovery backup. Use `pg_dump --format=custom --no-owner` against the direct Neon endpoint with credentials injected securely. Store encrypted logical backups outside Neon, with a separate retention/budget policy. Restore into an isolated empty database using `pg_restore --no-owner`, then verify counts, login, accepted programs and user isolation. Never use the live database for a restore test. Neon time-travel retention is finite and does not replace these backups.

The migrations enable row-level security with no browser policies. The backend database role owns the tables; its application query filters and write ownership checks remain mandatory. Database credentials never reach the browser.
