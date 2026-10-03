# NutritionApp cost findings

**Evidence date:** 2026-10-02. This report covers the deployed Nutrition API and PWA, its independent
Neon database, Nutrition-owned storage/maintenance, the FitnessAccount dependency, and provider
usage. The cross-app measurements, shared allowances, and limits are in
[`../COST_FINDINGS.md`](../COST_FINDINGS.md).

## Deployed service and measured cost

Production revision `nutrition-api-00050-nsr` had 100% of traffic at 1 CPU, 512 MiB, concurrency 20,
and a 180-second timeout. Its revision maximum is 1; service maximum is 20; minimum is zero/no
minimum annotation. The source now records the same service/revision limits and Direct VPC egress
route in [`deploy/cloudbuild.yaml`](deploy/cloudbuild.yaml). Direct VPC uses `default/default` and
sends all outbound traffic through the existing public NAT gateway. Preserve this egress path and
stable IP because provider pacing is shared behind it.

For 2026-09-01 through 2026-10-01 UTC, built-in Cloud Run metrics reported **41,564 requests**,
**3,601.8 billable instance-seconds**, and a maximum five-minute aligned memory p99 of **0.348 GiB**
(about 70% of the 512 MiB allocation). At the October 2 Singapore Tier 2 rates, applying 512 MiB to
that interval yields about **$0.144 gross**, or $0.0090 per request-active day and $0.00000346 per
service request. These are list-price averages, not a Nutrition-specific route or scan cost. The
service's share of Cloud Run allowances is below the account's free tier, but net payable amount is
unknown because those allowances are shared with other projects.

## Database and storage

The API connects to the independent `nutrition` database in the NutritionApp Neon project; it uses
pooled runtime connections with maximum pool size 10 and applies migrations through the controlled
deployment step. A read-only query found a 10,731,520-byte database, 30 public tables, and four
expiry-named indexes (`GoogleHealthOAuthStates`, `NutritionPushReminderDeliveries`,
`PublicFoodProducts`, and `Sessions`). The largest inspected relation was `DailyExpenditureEstimates`
at 448 KiB total. Some dead-row estimates were present in very small tables; this does not justify
vacuum-full, dropping indexes, or a speculative migration. The database size does not include Neon
branch/history storage, backup overhead, or billed compute activity; those provider quantities and
plan remain unknown.

The separate temporary scan bucket (now `nutrition-scans-396431756440`) had zero live objects in the read-only
inventory. Storage charges for future scans depend on stored GiB-hours, operations, and egress; no
current object-byte saving is identified. The physique-photo bucket shares infrastructure with the
FinancialApp vault and was deliberately not inventoried. Preserve the separate scan lifecycle and
photo retention rules.

## Normalized unit costs and gaps

| Journey or unit | Evidence available | Cost result |
|---|---|---|
| API request / request-active service day | Cloud Run built-in metrics only | $0.00000346 average gross per API request / $0.0090 per request-active UTC day; not per route or user |
| Scan | No route-level scan count or image-byte export | Unknown; include API/AI work, scan storage, retry, and cleanup cost divided by completed scans |
| AI chat | Model is `gpt-5.4-mini`; no production input/cached/output token export | Unknown. Current standard-rate formula: `($0.75 × uncached input + $0.075 × cached input + $4.50 × output) / 1,000,000` |
| Completed meal/diary day | No production journey counter | Unknown; preserve the 90-day editable meal-detail default and compaction boundaries |
| Identity, Workout peer, deferred Google Health sync | Cloud Run service totals cannot split routes | Unknown; include these requests and retries in the applicable journey numerator |
| Daily maintenance sweep | Scheduler job exists; no per-sweep DB/API meter export | Unknown; include its Cloud Run request, database work, image cleanup, deletion retries, and sync work |

The API defines route, database-command, and outbound-call meters, but source inspection found no
production Meter listener/exporter registration. Those definitions cannot establish route counts,
provider calls, database waits, or token usage. No new telemetry system was added.

## Opportunities and guardrails

- Keep 90-day meal-detail retention and fresh quota checks in `StorageService.AllowOptional`; lowering
  retention changes behavior and quota semantics are not a cost optimization target.
- Keep the current VPC/NAT route. Current monitoring observed about 0.1125 GiB of NAT bytes combined
  in sparse September samples; processing at list price is about $0.005 before the public IP and
  serverless assignment charges. The public IP itself is about $3.60 per full month at the current
  $0.005/hour rate. Exact NAT payable cost requires billing SKU data; removing it could break stable
  provider egress.
- Keep the daily `nutrition-daily-cleanup` Scheduler job.
  The job count cost is account-wide after three free jobs. Do not add a frequent reminder or health
  sync scheduler.
- No storage deletion, database change, model/prompt change, Vercel configuration change, or
  production deployment was made. OpenAI usage, Vercel plan/transfer, and Neon compute/branch charges
  remain unknown.
- The shared Artifact Registry's installed policy remains in dry-run mode and was not updated. The
  FinancialApp prefix keep rule is present only in the local policy proposal until a separately
  approved provider-policy reconciliation.

**Sources:** `deploy/cloudbuild.yaml`, `deploy/README.md`, `api/Program.cs`,
`api/Data/ConnectionSettings.cs`, `api/Services/RetentionService.cs`,
`api/Services/StorageService.cs`, and the root cross-app cost report. Current provider price references:
[Cloud Run](https://cloud.google.com/run/pricing), [Cloud NAT](https://cloud.google.com/nat/pricing),
[Cloud Storage](https://cloud.google.com/storage/pricing), and
[GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
