# Small durable history, temporary detail

## Retention contract

`Retention:MealDetailDays` defaults to seven calendar days including today, with a supported range of 3–90. The hourly authenticated maintenance endpoint processes up to 120 old days per user per invocation. In one per-user database transaction it writes each day's calorie total, nullable macro/fiber totals, entry count, and original completeness status, then deletes the detailed entries. Re-running is idempotent. Weights, custom foods/recipes, accepted coaching history and physique photo metadata remain.

The coach reads archived totals and recent detail through the same daily interface. Its full 28-day window remains intact even though only seven days retain food names and portions. An unknown macro in any entry keeps the corresponding archived total unknown, rather than inventing a complete total. Partial days remain partial; a day without a completeness assertion stays incomplete. Ordinary edits cannot rewrite archived totals or recreate expired detail.

Recent edits remain recoverable through the existing queue. If a device stays offline beyond the retention window, obsolete meal-detail edits stop for review and remain in its local queue. Export/copy that pending information before explicitly discarding it. Successful requests replay within the 90-day receipt window; after receipts expire, revision/date checks prevent duplicate inserts.

## Why this reduces storage

Twenty detailed entries per user per day become one summary row: a 95% reduction in that historical row count, before accounting for much shorter summaries and removed indexes/text. At two users, retained detail is bounded near 280 live entries at the assumed 20/day rate, rather than 146,000 entries after ten years. Daily summaries and weights add only hundreds of short rows per year per user. The food library is bounded at 1,000 records per user.

Operational scan rows expire after seven days, images after processing or 24 hours, and idempotency receipts after 90 days. External food lookup caches are bounded in memory and do not occupy PostgreSQL. Physique images never occupy database rows.

Deletion frees reusable PostgreSQL page space; it does not necessarily shrink the allocated database file immediately. Keep autovacuum enabled. Do not run automatic `VACUUM FULL`: it rewrites tables and takes disruptive locks, and needs operational planning. [PostgreSQL VACUUM](https://www.postgresql.org/docs/current/sql-vacuum.html).

## Physique photos

Reuse FinancialApp's private Google Cloud Storage JSON API and Application Default Credentials pattern, independently configured through `Physique:Bucket`. Object names are generated as `nutrition-physique/{user-id}/{photo-id}.jpg`. The browser never supplies a storage path. Private API ownership checks gate every content read and delete. Upload retries use an immutable object name, payload hash and `ifGenerationMatch=0`.

The browser downsizes to 1600 px and re-encodes JPEG, stripping source EXIF/location metadata. Each photo is capped at 750 KB, with a configurable default budget of 256 MiB/user. No full-resolution original or separate thumbnail is stored. The gallery lazily downloads compressed photos; compare two at their natural aspect ratio. User-selected photos remain until explicitly deleted. Abandoned uploads and failed deletions are retried by scheduled cleanup.

If sharing an existing FinancialApp bucket, use a separate nutrition runtime identity with a prefix-scoped IAM condition. Do not modify the financial bucket's versioning, soft-delete, retention, or lifecycle policy. A separate private bucket under the same GCP project is also supported and makes lifecycle policy independent. Keep public-access prevention and uniform bucket-level access enabled.

Live read-only inspection on 2026-09-07 confirmed the existing bucket `financialapp-vault-396431756440` is in `ASIA-SOUTHEAST1`, with public-access prevention enforced, uniform bucket-level access, versioning enabled, and 30-day soft delete. Photo deletion therefore reads and deletes the exact object generation, avoiding indefinite noncurrent-version retention. The bucket's 30-day soft-delete billing still applies. Local ADC is not configured on this machine; real uploads require runtime ADC or an explicitly configured local development identity.

GCS image storage, operations and egress are separately billed. Object versioning and soft delete can retain additional billable bytes, so evaluate the actual bucket configuration rather than assuming that deleting a photo immediately removes all storage charges. [GCS pricing](https://cloud.google.com/storage/pricing), [soft delete](https://docs.cloud.google.com/storage/docs/soft-delete).

## Measurement

`dotnet run --project tools/StorageBenchmark/StorageBenchmark.csproj` creates an isolated synthetic SQLite database under ignored `artifacts/`. It measures ten years of diary, daily status, weight and receipt data before/after compaction and vacuum. It is a local algorithm/storage comparison, not a Neon/PostgreSQL measurement. Production-size acceptance still requires the Neon project or an isolated PostgreSQL instance and includes catalog/index overhead. See `VERIFICATION.md` for captured results and limitations.

