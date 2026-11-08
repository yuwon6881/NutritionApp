# Durable history, bounded operational data

## Retention contract

Diary entries are kept for good. There is no compaction: every day keeps its foods, portions and times, stays editable, and all totals (Dashboard, coaching, Ask AI, export) derive from the entries. The daily authenticated maintenance endpoint only removes operational data: a deleted entry's marker after `Retention:TombstoneDays` (default 90), finished nutrition-upload rows whose entry is gone, idempotency receipts after `Retention:ReceiptDays` (default 90), scans, expired sessions and similar bookkeeping. Weights, custom foods/recipes, accepted coaching history and physique photo metadata are never pruned.

Recent edits remain recoverable through the existing queue. Successful requests replay within the 90-day receipt window; after receipts expire, revision checks prevent duplicate inserts for live records.

## Why this stays small enough

Twenty detailed entries per user per day is about 7,300 rows a year, a few MB with indexes. The application warns at `Storage:DatabaseWarningBytes` (350 MB) and pauses optional writes at `Storage:DatabaseBlockBytes` (400 MB), both configurable and sized for the 0.5 GB Neon Free project. Watch the storage overview as history grows; export remains available if the limit nears. The food library is bounded at 1,000 records per user.

Operational scan rows expire after seven days, images after processing or 24 hours, and idempotency receipts after 90 days. Open Food Facts results are shared only as compact, account-independent product rows with one-day freshness and bounded maintenance cleanup; saved foods remain account-scoped. Physique images never occupy database rows.

Deletion frees reusable PostgreSQL page space; it does not necessarily shrink the allocated database file immediately. Keep autovacuum enabled. Do not run automatic `VACUUM FULL`: it rewrites tables and takes disruptive locks, and needs operational planning. [PostgreSQL VACUUM](https://www.postgresql.org/docs/current/sql-vacuum.html).

## Physique photos

Reuse FinancialApp's private Google Cloud Storage JSON API and Application Default Credentials pattern, independently configured through `Physique:Bucket`. Object names are generated as `nutrition-physique/{user-id}/{photo-id}.jpg`. The browser never supplies a storage path. Private API ownership checks gate every content read and delete. Upload retries use an immutable object name, payload hash and `ifGenerationMatch=0`.

The browser downsizes to 1600 px and re-encodes JPEG, stripping source EXIF/location metadata. Each photo is capped at 750 KB, with a configurable default budget of 2 GiB/user (about 17 years of weekly three-view photos). No full-resolution original or separate thumbnail is stored. The gallery lazily downloads compressed photos; compare two at their natural aspect ratio. User-selected photos remain until explicitly deleted. Abandoned uploads and failed deletions are retried by scheduled cleanup.

If sharing an existing FinancialApp bucket, use a separate nutrition runtime identity with a prefix-scoped IAM condition. Do not modify the financial bucket's versioning, soft-delete, retention, or lifecycle policy. A separate private bucket under the same GCP project is also supported and makes lifecycle policy independent. Keep public-access prevention and uniform bucket-level access enabled.

Live read-only inspection on 2026-09-07 confirmed the existing bucket `financialapp-vault-396431756440` is in `ASIA-SOUTHEAST1`, with public-access prevention enforced, uniform bucket-level access, versioning enabled, and 30-day soft delete. Photo deletion therefore reads and deletes the exact object generation, avoiding indefinite noncurrent-version retention. The bucket's 30-day soft-delete billing still applies. Local ADC is not configured on this machine; real uploads require runtime ADC or an explicitly configured local development identity.

GCS image storage, operations and egress are separately billed. Object versioning and soft delete can retain additional billable bytes, so evaluate the actual bucket configuration rather than assuming that deleting a photo immediately removes all storage charges. The database records the uploaded generation and retains a bounded exact-generation deletion queue for replacements; tombstones are purged only after external deletion succeeds. [GCS pricing](https://cloud.google.com/storage/pricing), [soft delete](https://docs.cloud.google.com/storage/docs/soft-delete).

## Measurement

Production-size acceptance still requires the Neon project or an isolated PostgreSQL instance and includes catalog/index overhead. `tools/DatabaseAdmin` runs the isolated-schema verification; `VERIFICATION.md` records captured results and limitations.

