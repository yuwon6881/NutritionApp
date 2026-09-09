# Deployment and recovery

The nutrition app uses an independent Neon PostgreSQL database, a Vercel PWA, and a Cloud Run API in Singapore. The FinancialApp service and database are independent.

## Database and secrets

The API accepts a PostgreSQL URL or an Npgsql connection string in `ConnectionStrings__Database`. Neon URLs are normalized with verified TLS, required channel binding, and a maximum local pool size of 10. Runtime uses the supplied `-pooler` hostname. Migrations use its direct counterpart without `-pooler`.

Store the connection, `OpenAi__ApiKey`, optional `Usda__ApiKey`, and `Cleanup__Token` in Google Secret Manager. No secret belongs in Vite variables or source control. The ignored `deploy/neon.local.json` is only for local provisioning; it is excluded from Git and Docker contexts. The previously supplied Neon project ID was discarded.

`dotnet run --project tools/DatabaseAdmin/DatabaseAdmin.csproj -- inspect deploy/neon.local.json` reads tables and size. The `migrate` command refuses unexpected public tables before applying EF migrations. `neon deploy` manages Neon infrastructure configuration; it does not replace the ASP.NET EF schema migrations. No Neon Auth, Neon Functions, or Neon object storage are needed by this application.

Neon Free currently includes 0.5 GB storage per project. The 350 MB warning and 400 MB optional-write limit are application budgets, not provider quota telemetry; monitor branch/history overhead and Neon compute quotas in its console. Meal details now default to 90 calendar days before compaction. [Neon pricing](https://neon.com/pricing).

## API and files

Build the API-only Dockerfile using Cloud Build. Deploy a new Cloud Run service with `Auth__MaxUsers=2`, `OpenAi__Model=gpt-5.4-mini`, `Database__MigrateOnStartup=false`, `Retention__MealDetailDays=90`, minimum instances 0 and maximum instances 1. `PublicOrigin` must be the exact Vercel production HTTPS origin, without a trailing slash. Review memory and request timeouts against actual workloads.

`Physique__Bucket` selects the existing private GCS bucket. Grant the nutrition runtime identity access only to the `nutrition-physique/` prefix. Keep FinancialApp bucket policies unchanged. Its versioning/30-day soft-delete policy applies to physique photos; deletion targets the exact generation.

`ScanStorage__Bucket` selects a separate private temporary GCS bucket. Use uniform access, public-access prevention, no versioning, and an explicit short retention policy suitable for disposable scans. Uploaded objects are under `nutrition-scans/`. Delete scans immediately after processing and abandoned uploads after 24 hours. A bucket lifecycle rule is an additional fallback, not an exact-time deletion guarantee. Physique photos must never share the temporary bucket's lifecycle.

Configure an hourly Cloud Scheduler POST directly to the API `/internal/cleanup`, supplying its protected `X-Cleanup-Token`. Scheduler wakes Cloud Run independently of the PWA. Alert on failures. The endpoint runs scan cleanup, atomic diary compaction and pending physique deletion retries.

## Vercel

Deploy the `web` directory as a Vite project. The Vercel routing configuration proxies `/api/*` to the new Cloud Run service, keeping requests and HttpOnly cookies on the PWA origin. This avoids reliance on third-party cookies on iPhone. Never enable CDN caching for authenticated API responses. `/internal/*` is not a frontend route. Unknown asset URLs must return 404 rather than the SPA document.

Set the exact backend origin in the checked routing configuration before deployment. Verify Secure/HttpOnly/SameSite cookies, retained Origin headers, private responses, PWA installation, asset MIME types, and large photo requests through the deployed proxy. [Vercel external rewrites](https://vercel.com/docs/routing/rewrites).

## Backup and restore

An authenticated JSON export is not a disaster-recovery backup. Use `pg_dump --format=custom --no-owner` against the direct Neon endpoint with credentials injected securely. Store encrypted logical backups outside Neon, with a separate retention/budget policy. Restore into an isolated empty database using `pg_restore --no-owner`, then verify counts, login, accepted programs and user isolation. Never use the live database for a restore test. Neon time-travel retention is finite and does not replace these backups.

The migrations enable row-level security with no browser policies. The backend database role owns the tables; its application query filters and write ownership checks remain mandatory. Database credentials never reach the browser.
