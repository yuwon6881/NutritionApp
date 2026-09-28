# Android-first performance — 2026-09-28

## Implemented scope

- Startup shares account hydration while session validation runs concurrently. Local commits write changed IndexedDB partitions only; queue acknowledgement and basket retirement remain atomic. Legacy embedded foods migrate without replacing authoritative empty partitions or retained drafts. Dated-cache reads use an indexed range.
- Pending-state projection uses copy-on-write, preserves stable references, and sorts changed collections only. Acknowledgement copies shared records and rebases retained mutations without mutating the prior snapshot. Sync feedback does not invalidate the page projection; closed food dialogs suspend optional work.
- Bootstrap validators include account, local date, retention, domain and integration revisions. Progress supports conditional GET with the same response contract. Client reads coalesce, cancel obsolete account work, and guard late responses. Pending mutations project locally without triggering Progress requests. Hidden/offline scheduled network polling pauses while local calendar rollover continues.
- Focused bootstrap reads, no-tracking queries, bounded trajectory completeness plus preceding seed, indexed membership, and loaded-record reuse reduce database work without truncating the history used by trends. Bounded in-process gates coalesce cache misses for Progress and public food lookups. Account ranking remains separate. No new database index was added without production plan evidence.
- Coach commits the destination immediately and animates its entrance with existing direction/easing and reduced-motion behavior. Completed Web Animations release persistent fill transforms. Swipe/chart/slider input coalesces per frame, caches geometry, flushes release coordinates, and cleans up cancellation. Selection markers batch reads before writes; equivalent progress fills use transforms and transitions name their intended properties.
- Photo resize/JPEG encoding runs in a disposable worker where supported, with asynchronous Blob fallback, unchanged size/quality caps and metadata stripping. Image/object URL resources are released. Photo panels load separately; bundled Android and precached PWA assets remain available offline. Fingerprinted assets cache immutably while HTML/service-worker update checks and private API protections remain intact.
- Existing metrics now measure EF command completion/failure/cancellation durations. Reader lifetime, account-lock waiting, application read/trend spans and existing provider durations are separate instruments. Reader/materialization spans are inclusive, not pure computation timings. Optional local browser marks record startup, dashboard, navigation, durable save, dialog opening and photo preparation; there is no telemetry upload or paid monitoring.

## Measurement protocol

Local synthetic fixtures contain 7, 365 or 3,650 days, up to eight meals per retained day, 1,000 saved foods, and a retained 1.5 MB photo draft for the largest account. Browser fixtures intentionally retain complete weight/day history to stress older caches; ordinary bootstrap remains bounded. A separate scenario retains 120 terminal outbox conflicts. Providers are mocked. Browser runs use a Pixel 7 viewport, Chromium and 4× CPU throttling, with five HTTP-cache-cleared reloads and 20 warm reloads. These are not native cold launches or physical Android frame-rate measurements.

The browser harness records startup through visible Dashboard, navigation through the next animation frame, and save through dialog dismissal after durable local commit. It also records local marks, IndexedDB writes, long tasks, heap snapshots, request counts and CDP encoded network bytes. Mock response `Content-Length` alone is incomplete; CDP byte totals are the useful transfer measurement. Synthetic gesture events test coalescing and frame intervals, not real-device touch latency. Results are local artifacts, not continuous telemetry.

A separate worker test encodes the same deterministic 3,000×2,000 synthetic PNG 25 times, recording photo-preparation duration and main-thread frame intervals. Its 9.4 MB input stays below the existing 20 MB input limit. CDP bytes include synthetic browser traffic; they cannot predict live-provider or production transfer costs.

Server fixtures use an isolated SQLite database, real HTTP/auth/serialization paths, full trend history and mocked integrations. Five service-cache-cleared and 20 warm reads record elapsed time, SQL commands and uncompressed response body bytes. They do not measure PostgreSQL production plans, deployment cold starts, or compressed network transfer.

## Recorded results

Final browser measurements and release checks are recorded below after the final build. Initial source investigation contained no device or production benchmarks; these local results do not establish the physical-device acceptance goals.

Copy-on-write projection microbenchmark warm p95 (milliseconds):

| History | Pending writes | Original | Optimized |
| --- | ---: | ---: | ---: |
| 7 days | 0 / 1 / 120 | 5.837 / 3.042 / 2.598 | 0.001 / 0.025 / 0.492 |
| 365 days | 0 / 1 / 120 | 3.899 / 4.450 / 3.946 | <0.001 / 0.192 / 0.596 |
| 3,650 days | 0 / 1 / 120 | 8.007 / 8.349 / 9.558 | <0.001 / 1.598 / 1.817 |

Microbenchmark fixtures run five cold and 20 warm iterations. Near-zero empty-queue results reflect returning the original state; they are not whole-application startup timings.

Final isolated API warm p95 (milliseconds), including HTTP/auth/JSON work:

| History | Bootstrap | Bootstrap SQL / body bytes | Progress all | Progress SQL / body bytes |
| --- | ---: | ---: | ---: | ---: |
| 7 days | 31.7 | 16 / 58,218 | 6.9 | 5 / 3,090 |
| 365 days | 30.0 | 16 / 306,455 | 5.6 | 5 / 27,559 |
| 3,650 days | 33.9 | 16 / 306,455 | 4.8 | 5 / 36,170 |

SQL counts include authentication. Bootstrap bytes plateau with bounded detail; Progress tests verify full-history statistics rather than truncating trend mathematics. These are current local measurements, with no original API baseline and no production latency claim. The final build uses 414/430 KiB first-load JavaScript and 1,087/1,150 KiB precache (original: 408 and 1,076 KiB). Both enforced ceilings pass.

Initial and final Pixel-viewport browser runs (warm p95 milliseconds, Chromium 151.0.7922.34, 4× CPU):

| Retained history | Dashboard original → final | Navigation original → final | Durable save original → final |
| --- | ---: | ---: | ---: |
| 7 days | 1,455 → 1,949 | 882 → 648 | 1,404 → 825 |
| 365 days | 1,796 → 1,928 | 683 → 715 | 2,063 → 977 |
| 3,650 days | 3,617 → 3,024 | 1,888 → 1,299 | 5,516 → 2,361 |

The unmatched small-account startup pair shows a 34% increase, above the 10% regression threshold. A fresh original build served from the same workspace path as the updated bundle measured 1,400 ms startup, 452 ms navigation and 818 ms save; an adjacent updated run measured 814 / 184 / 347 ms. The original bundle served from another drive measured 3,408 / 1,845 / 3,885 ms in a separate run. This large host variability prevents a strong absolute p95 claim, but the same-path comparison found no startup regression. The final full runs issued 25 authentication, notification, bootstrap and Google Health-status requests each, no disconnected-Dashboard training request, and 49 sync attempts per fixture. Those sync attempts receive synthetic 503 responses to retain work. Startup marks beginning when the entry JavaScript executes were 1,514 / 1,338 / 1,432 ms warm p95 respectively in the full run; bundle parse/evaluation and native launch are outside that mark. CDP recorded 12.9 / 18.2 / 35.7 MB of encoded synthetic network activity across 25 runs. The 10-year warm heap snapshot peaked at 37.3 MB; this is a snapshot, not peak native memory.

Synthetic card swipes kept 94.1% of 60 Hz frame intervals ≤20 ms under 4× CPU throttling; six-megapixel asynchronous photo preparation measured 270 ms warm p95 with 94.3% of sampled intervals ≤20 ms. Both frame rates are below the 95% goal in this desktop simulation. This is not physical Android evidence and does not establish real touch responsiveness. The local server warm-read goal is met in isolated SQLite; the cached-dashboard, navigation, save and gesture goals are not met in the throttled browser fixture. They remain open for device testing and further tuning.

With 120 retained terminal conflicts, ten-year history and the retained photo draft, warm p95 was 3,034 ms Dashboard, 1,436 ms navigation and 1,591 ms local save. The tested weigh-in targeted an already-conflicted record, so the protected mutation remained local and the harness issued no `/api/sync` request. Independent mutations draining past a terminal conflict are covered by the browser/API regression suite. This stress run verifies retention and bounded local behavior, not server throughput for a large dispatchable queue.

## Reproduction and remaining acceptance

From the repository root, run `node web/scripts/benchmark-projection.mjs` and `dotnet test tests/Nutrition.Tests.csproj`. From `web`, build first, then run `npx.cmd playwright test --config performance.config.ts`. Set `NUTRITION_PERFORMANCE_LABEL` to distinguish outputs; set `NUTRITION_PERFORMANCE_OUTBOX=120` and select the 3,650-day test for retained-outbox stress. Keep builds/browser/benchmark jobs serialized. Artifacts are ignored and contain synthetic data only.

The release gate passed 292 frontend unit tests, 291 API tests, and all 130 visual/browser tests against an isolated development database; the earlier browser attempt found an offline-midnight defect and two connected-account fixture mismatches, all fixed before the passing rerun. Frontend documentation/standards/type checks and the production build passed. Responsive tests cover 390/768/1440 px in both themes, plus touch, Back/Escape, focus, reduced motion, offline restart, retained conflicts, Undo and midnight rollover. Documentation equality and `git diff --check` are final release checks.

Acceptance goals remain: p95 tap feedback/cached navigation ≤100 ms; durable local save ≤200 ms; cached Android Dashboard ≤1 second after WebView JavaScript starts; ≥95% of 60 Hz gesture intervals ≤20 ms; warm provider-independent API server duration ≤300 ms. CPU-throttled desktop results do not certify Android goals. Record native startup and server cold starts separately, repeat on a modest physical Android phone with device/WebView versions, and inspect PostgreSQL plans before considering any index. Live provider call counts and production cache behavior require external validation. No paid services, artificial keep-alive, larger instance/database tier, new batch-sync protocol, or infrastructure scaling changes were introduced.
