# Verification status

Local implementation verified on 2026-09-10. This is not a production release certificate.

## Automated checks

- `dotnet test tests/Nutrition.Tests.csproj --no-restore --nologo`: 91 tests passed. Includes coaching directions and eligibility, persistence, registration concurrency, tenancy, revisions, retention equivalence, unknown nutrients, Neon connection normalization, GCS generation-specific deletion, separate scan storage, and photo quota and retry/ownership behavior.
- `npm.cmd run typecheck` in `web`: passed.
- `npm.cmd test` in `web`: 76 tests passed across 17 test files (projection, profile equality, energy-balance history, coachCalc live pace & resting expenditure, and related frontend coverage).
- `npm.cmd run build` in `web`: TypeScript and production PWA build passed.
- `dotnet ef migrations has-pending-model-changes --project api/Nutrition.Api.csproj --no-build`: no pending model changes.
- NuGet vulnerability scan: no known vulnerable dependencies. npm audit after updating Vite to 8.2.2: zero vulnerabilities.
- Browser suite: 37 end-to-end scenarios passed against the isolated local API, including sync feedback, onboarding, responsive screen and 44px touch-target audits, API idempotency and CSRF origin protection, physique-photo offline drafts, validation, motion, retry, and phase pacing. Screens were checked at 390, 768, and 1440 px with zero horizontal overflow and compliant touch targets.

## Ten-year storage experiment

Command: `dotnet run --project tools/StorageBenchmark/StorageBenchmark.csproj`.

Two users, 20 entries per day, ten years, with daily statuses, weigh-ins, mutation receipts and indexes:

| Measurement | Result |
|---|---:|
| Initial detailed entries | 146,000 |
| Entries retained after compaction | 280 |
| Archived day summaries | 7,286 |
| Weights retained | 7,300 |
| Recent receipts retained | 3,600 |
| SQLite allocated bytes before cleanup | 108,175,360 |
| Allocated bytes after deletion alone | 108,175,360 |
| Bytes after explicit benchmark VACUUM | 4,923,392 |
| Compacted storage reduction | 95.4% |

The experiment uses a disposable SQLite database. It excludes personal food libraries, accepted plans, photo metadata and PostgreSQL catalog overhead. It verifies the retention algorithm and demonstrates the difference between reusable free pages and physically reclaimed file space. It does **not** establish the Neon 350 MB total-database design budget. Do not run automatic production VACUUM FULL based on this experiment.

## Neon and storage provisioning

- Applied all three nutrition migrations to the replacement Neon database. Verified direct and pooled connections with certificate validation and required channel binding. The previously retracted project ID was not linked or used.
- Isolated PostgreSQL verification passed: two concurrent registration slots, tenant isolation, idempotent replay, and equivalent coaching results after compaction. The temporary schema was removed; no test users were added to public application tables.
- A ten-year fixture of 7,300 summaries and 7,300 weights used 4,005,888 bytes including indexes in its isolated schema. This excludes other long-term entity types. The application database measured 8,421,376 bytes after removal of that schema.
- Created an independent Cloud Run runtime identity and scoped Secret Manager access. Credentials are in ignored local deployment files and Secret Manager, excluded from Docker input.
- Created private scan bucket `nourish-scans-396431756440`, with soft delete disabled and an age-one-day deletion lifecycle for the nutrition scan prefix. Lifecycle deletion is asynchronous; hourly application cleanup is still needed for the intended expiry contract.
- Added a nutrition-prefix-only runtime grant on the existing physique bucket. Its versioning and 30-day soft-delete settings were preserved.

## Deployed verification status (2026-09-10)

- **Cloud Run API**: Deployed to `https://nourish-api-i47taxhzba-as.a.run.app` (`asia-southeast1`). Runtime service account `nourish-api` scoped to Secret Manager and GCS buckets. `PublicOrigin` set to `https://nutrition-diary-app.vercel.app`.
- **Vercel PWA**: Deployed to `https://nutrition-diary-app.vercel.app`. Serves PWA assets, manifest, deduplicated service worker (`sw.js`), and proxies `/api/*` and `/health` to Cloud Run with `Cache-Control: no-store`. Missing assets return 404 text responses without SPA fallback.
- **Neon PostgreSQL**: Applied all migrations on `neondb` in `ap-southeast-1` (`ep-noisy-bar-b3gvfj2z`). Direct and pooled connections verified with SSL and channel binding. Both registration slots (1 and 2) remain open and available for user registration (`registrationOpen: true`).
- **Cloud Scheduler**: Configured and enabled `nourish-hourly-cleanup` on `17 * * * *` invoking `POST /internal/cleanup` with `X-Cleanup-Token`. Execution verified returning HTTP 200 `{"deleted":0,"compactedEntries":0,"deletedPhotos":0}`.
- **Security & Origin checks**: CSRF/Origin enforcement verified (non-origin POSTs return 403; unauthorized requests return 401). Internal cleanup route returns 404 through Vercel public routing.
- **Automated test suite**: 91 .NET tests passed; 76 frontend Vitest tests passed; TypeScript (`tsc -b`) and production PWA bundle build passed; 37 Playwright end-to-end browser scenarios passed against the isolated local API.

## Pilot acceptance gates still open

- Complete ten-year PostgreSQL fixture including foods, programs, receipts, scan operations and photo metadata against the total database budget.
- Real GCS upload/read/delete: transport and persistence tested with a fake HTTP handler; local ADC unavailable. Existing bucket has versioning and 30-day soft delete.
- Real OpenAI and food-provider calls with configured server secrets; measured AI errors from weighed meals and known labels, including Malaysian mixed dishes. `tools/ai-evaluation.mjs` computes measured errors from supplied evaluation cases; no accuracy claim is made without those cases.
- Physical Android Chrome and iPhone Safari/Home Screen: camera, barcode, installation, keyboard/safe areas, accessibility, interrupted requests and browser-storage loss. Desktop Chromium viewport tests are not physical-device evidence.
- Isolated PostgreSQL backup/restore exercise and two-user pilot.

Nutrition export includes durable daily summaries, retained detail, foods/recipes, weights, accepted programs and physique photo metadata/download routes. Photo binaries remain private GCS objects and are not embedded in the JSON export.


