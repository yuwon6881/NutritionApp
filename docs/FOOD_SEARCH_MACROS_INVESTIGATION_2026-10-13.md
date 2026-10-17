# Food search nutrition investigation — 2026-10-13

This records the initial investigation snapshot before the follow-up implementation described below. No deployment, provider subscription, or infrastructure was changed.

## Follow-up direction

The user clarified that opening these rows retrieves nutrition, and prioritised preserving food choices and improving the delayed transition. The follow-up keeps unresolved rows, displays available confirmed P/C/F, opens a named review skeleton immediately, supports retry/Back/safe label entry, repairs rows after a successful opening, bypasses extra lookups for confirmed 100-g foods, and adds bounded search-confirmation recovery. The complete-row filtering alternative below is not the selected implementation. Server queue reservation and explicit per-code verification outcomes remain separate proposed improvements. The initial evidence and findings below describe the source before these follow-up changes.

Additional source finding: the existing favourite path (`useFoodFavourite.ts` → `favouriteMutation` in `lib/savedFoods.ts`) can save a new unverified search result's numeric snapshot with a 100-g basis. Reopening a private mapping then treats it as confirmed. That path should confirm a new public snapshot before persistence, while retaining authoritative existing private mappings. This follow-up changes search/review recovery, not the favourite persistence contract or historical saved records; this finding remains proposed work and has not been reproduced against a live account.

## Follow-up verification

- `dotnet test tests/Nutrition.Tests.csproj --no-restore`: 592 passed, zero failed/skipped. No API application code changed.
- `npm.cmd test`: 545 passed across 112 files. Typecheck, documentation equality, standards, production build/budgets, and `git diff --check` passed.
- Fresh production-preview browser coverage passed all 28 food-review cases and both keyboard cases. The combined food/keyboard/touch run initially reported 39 passed and one failed: the existing touch Back test referenced a batch Actions button removed by concurrent work. After switching that test to the shared real-touch swipe helper, `npm.cmd run test:visual -- mobile-logging.touch.spec.ts --project=mobile-chromium` passed all nine touch cases plus setup (10 total).
- Loading/recovery tests use stub provider responses and an isolated development API/database, not a production or personal diary. They cover 390/768/1440 px in both themes, retained choices and null macros, immediate named loading review, retry, Back/Escape, cancellation of late detail responses, exact result focus restoration, cache repair, confirmed 100-g opening without a lookup, paced bounded verification recovery, and reduced motion. All six loading screenshots were visually inspected.
- The full `npm.cmd run test:visual` gate did not pass and remains incomplete. It was stopped after repeated failures outside the food changes: coaching tests still selecting the renamed Plan button or old heading, batch tests selecting a removed Actions control, and search focus tests requiring an outline the concurrently edited styling removes. Its food fixture collision and missing-basis keyboard fixture were corrected and passed their focused reruns. Concurrent feature/style work was preserved.
- No commit, push, deployment, physical Android check, or authenticated live-provider UX reproduction was performed. Source/browser evidence does not guarantee external provider availability.

## Follow-up 2026-10-16: bulk read diagnostics and fallback

A user report (Sunglo yogurt, all visible Open Food Facts rows unresolved while opening each row worked) points at a request-level bulk failure, since individually incomplete products would also fail when opened. The cause was inferred from source; Open Food Facts was not reachable from the investigation environment, so the actual status code is unconfirmed. Changes:

- `OpenFoodFactsProvider.ReadProducts` logs a refused or unusable bulk read (HTTP status, code count, retry-after) instead of swallowing it. Search `external.request.count` with `service=open_food_facts` and these warnings to read the real status after deployment.
- A bulk 429 honours `Retry-After` (default 10 s) by holding the bulk gate.
- A slot cancelled before its request was sent is handed back for both the bulk and barcode gates (only while no later call has claimed one).
- The confirming read (`VerifyBasis`) falls back to the per-product endpoint for the first three unresolved rows after a failed bulk read and stops at the first refusal. Confirmed rows go to the durable cache. The search itself makes only the single bulk attempt.

- The three pacing gates moved from static fields into `OpenFoodFactsPacing` (one shared instance in production, injectable for tests), so tests no longer depend on slots other tests spent.

### Production result and second iteration

Cloud Run logs from the first deployed revision showed the bulk read answering HTTP 503 with no `Retry-After` (not 429), twice in a row about six seconds apart, after which the per-product fallback confirmed 3 of 3 rows; `/verify` took 14.5 s, about six of them waiting for a bulk slot that was certain to fail again. Changes:

- A failed bulk read is remembered for 60 s in `OpenFoodFactsPacing`; while remembered, neither the search nor the confirming read tries it, and the confirming read goes straight to the per-product fallback. A successful bulk read clears the memory.
- Rows being confirmed show motionless placeholders for the energy line and the P/C/F row (`FoodPicker`, driven by `FoodVerificationRecovery`'s `changed` callback) instead of "Nutrition loads when opened", which returns only if confirmation settles with the row unresolved. The rows stay in the placeholder state through the retry wait, so a first failed attempt does not flash the text.

Coverage: `tests/FoodBulkRecoveryTests.cs`, `web/src/lib/foodVerificationRecovery.test.ts`, and the placeholder cases in `web/e2e/food-review.spec.ts`.

## Follow-up 2026-10-17: opening a row refused with a 60-second countdown

Cloud Run logs at 06:18 UTC: a search's bulk read answered 503; `/verify` (06:18:21.4, 8.5 s) went to the per-product fallback; the person opened the first row at 06:18:23.8 and `/foods/barcode/0810067723183` answered 429; the fallback logged "confirmed 3 of 3" at 06:18:29.9, after which the list showed nutrition and those rows opened without a lookup. Read-only probes the same day: the bulk endpoint answered 503 to 8 of 9 requests (including single-code reads), the product endpoint 7 of 7 OK, so the bulk outage is upstream and the fallback is the path that actually confirms rows.

Two defects turned that outage into a failed opening:

- The fallback reserved product-endpoint slots ahead through the same gate a person's opening uses. With the next slot already queued, the opening's wait exceeded the 5 s limit and was refused as `Throttled`.
- That refusal was a 429 without `Retry-After`. The client treats a header-less 429 as the account's one-minute limit and holds every food lookup (search, verify, barcode) behind a 60 s countdown.

Fix: the fallback takes a product slot only when the gate is idle (`ProviderGate.ReserveWhenIdle`), so an opening waits at most one 4.1 s interval; it stores each row as it is confirmed and keeps them if the deadline ends it. Food-provider 429s carry `Retry-After` (`DomainException.RetryAfter`), and the client waits out a short 429 on a product read instead of failing the review. Coverage: `FoodBulkRecoveryTests` (fails with the old queueing as `Throttled`), `FoodSearchTests.A_refusal_to_wait_says_how_long`, and `web/src/lib/api.test.ts`. Rows beyond the first three still depend on the bulk endpoint recovering. The product endpoint allows 15 reads a minute, so confirming every row one by one is not an option.

Coverage of the first iteration: `tests/FoodBulkRecoveryTests.cs`. This reduces the placeholder rather than guaranteeing it away; the logged status decides what comes next.

## Conclusion

Keeping unresolved rows preserves products whose nutrition can be retrieved when opened. This is the selected direction: improve confirmation and the loading review without reducing food choices. The app cannot guarantee complete nutrition for every matching product from the current external catalogues. More retries cannot create nutrients a provider has never recorded.

Requiring complete nutrition before displaying a row would produce a complete-only list, but omit unresolved or incomplete products and potentially return fewer matches or no matches during an outage. That alternative is not being implemented.

The repeated placeholder is partly caused by fixable application behavior. The previous fixes improved recovery but retained a best-effort contract; they were never a guarantee that every row would resolve.

## Evidence and scope

- Repository examined at HEAD `3d541b281f1b0eccda79075f7ea14448238238e0`. Current application source, food-provider implementations, API contracts, caches, selection behavior, tests, and relevant Git history were inspected.
- Live public Open Food Facts search calls were made for whey, Milo, green tea, and honey. A bulk product read compared the twelve whey hits with their canonical product records; a separate product read checked the incomplete honey example.
- Production Cloud Run configuration and seven days of food-route request logs were inspected read-only. Latest ready revision was `nutrition-api-00067-7rn`, receiving 100% of traffic, with revision instance cap 1 and request concurrency 20. This does not prove local source/image parity.
- The retrieved production logs contained 24 search requests and five verification requests, all HTTP 200. Verification latency was approximately 5.1–6.0 seconds. Response bodies were unavailable; a 200 cannot establish successful enrichment because this endpoint can return an empty array after an upstream failure.
- Focused API tests passed: 94 passed, zero failed/skipped. Focused frontend unit tests passed: 18 passed across four files.
- An isolated temporary .NET console harness called the actual provider, parser, gate, and embedded dataset. It reproduced suppressed bulk failures, later successful recovery, calorie-only product acceptance, and retained queue reservations. The harness used stub HTTP and in-memory SQLite; it did not access a personal diary.
- No authenticated browser/session reproduction, full browser suite, full repository test suite, or physical Android verification was performed. The user's exact failing food/query and network response were not available at investigation time.

## How a search reaches the screen

1. `useSearchAsYouType` waits 800 ms after typing, with a minimum of three characters, then requests `/api/foods/search`.
2. `FoodCatalog` fans out to configured providers. Once any provider returns matches, the others have a two-second merge grace; Open Food Facts also has its own fifteen-second search deadline.
3. Open Food Facts searches Search-a-licious. Its numeric results are marked `unverified` because the search index can disagree with the product API about the quantity basis.
4. The provider checks its durable product cache, then attempts one bulk `/api/v2/search?code=...` read. These bulk calls reserve slots 6.1 seconds apart, shared across requests in the process.
5. A successful canonical product read replaces the nutrients, serving fields, and basis. A failed bulk HTTP response or non-cancellation exception can leave the search hits unverified. Cancellation instead propagates and causes the catalogue to discard that provider's answer; it does not preserve its search hits.
6. The browser displays verified energy/serving text, or `Nutrition loads when opened`. It sends one follow-up `/api/foods/verify` request for up to ten eligible unverified Open Food Facts rows.
7. Successful follow-up data updates the rows in place. Failure or an empty reply leaves them unchanged. Opening a row can try the separate barcode path, which has different endpoint pacing and provider fallbacks.

## Findings

### 1. Hiding unverified numbers protects against a demonstrated provider error

Live product `0748927065725`, Optimum nutrition whey protein:

| Field | Search index, labelled per 100 g | Canonical product, per 100 g |
| --- | ---: | ---: |
| Calories | 117 kcal | 384.868 kcal |
| Protein | 24 g | 78.947 g |
| Fat | 1 g | 3.289 g |
| Carbohydrate | 3 g | 9.868 g |

The canonical product declares a 30.4 g serving. The search numbers describe that serving, despite their `_100g` field names. Using the index directly would understate this product's per-100-g nutrition by about 70%. Requesting serving metadata from Search-a-licious did not return it in this live sample.

Source: `api/Services/Food/Providers/OpenFoodFactsParser.cs`, especially `ReadProduct` and `ApplyHydratedProduct`. Live [canonical product](https://world.openfoodfacts.org/api/v2/product/0748927065725?fields=code,product_name,nutriments,serving_size,serving_quantity,serving_quantity_unit).

### 2. Follow-up failure can remain pinned in the browser

`web/src/components/useSearchAsYouType.ts` calls `confirm` after a fresh search. It catches verification errors without a state transition or retry. Its query cache stores plain result arrays, with no freshness/verification timestamp. Both `search` and the effect return cached rows immediately; neither retries confirmation for cached unresolved rows.

Therefore, one failed follow-up can survive repeating the same query or returning from review during that dialog's lifetime, even after the upstream service recovers. The server's one-minute partial-search TTL does not help when the browser sends no new request. Closing/reopening the dialog clears its cache, but does not guarantee provider recovery.

### 3. Provider failures are collapsed into an apparently successful empty verification

`OpenFoodFactsProvider.ReadProducts` returns whatever it found in cache when the bulk HTTP response is unsuccessful, and catches other non-cancellation exceptions. `FoodCatalog.VerifyBasis` returns an empty list on its own timeout. An open provider breaker also returns an empty list.

There is no per-code distinction between temporarily unavailable, missing product, missing calories, or a genuinely incomplete product. The temporary harness reproduced a bulk 503 returning an unverified search row, followed by verification returning zero rows without surfacing a provider error. After explicitly retrying against a recovered stub, the same source code returned the correct nutrients.

### 4. Cancelled bulk requests can consume unused queue slots

`ProviderGate.Reserve` advances `next` immediately. The bulk read uses an unbounded reservation and can be cancelled while waiting. `ReadProducts` does not return a reservation that was cancelled before sending HTTP.

The harness reserved and cancelled four slots, with waits of approximately 0, 6.1, 12.2, and 18.3 seconds. The next reservation still waited 24.4 seconds, exceeding verification's twenty-second deadline before any network work. This demonstrates a reachable queue weakness; it does not establish that this sequence caused a particular production incident.

Even legitimate concurrent requests can create the same deadline pressure. Extending a timeout merely moves the threshold; it does not solve demand exceeding provider capacity. Process-local static gates also do not coordinate overlapping Cloud Run revisions or multiple processes sharing an egress address.

### 5. Not every unresolved row is attempted

The provider asks for twelve search hits; the client verification helper selects at most ten eligible codes. Any additional surviving unresolved rows receive no automatic follow-up in that list. Malformed/missing codes are ineligible. There is no second pass after an incomplete reply.

### 6. Confirmed basis is different from complete macros

`OpenFoodFactsParser.ReadProduct` requires calories, but permits null protein, fat, and carbohydrate. The product read can mark such a row `per100g`. FatSecret's mappings and the bundled USDA parser also preserve missing nutrients.

Live honey product `3375801867013` reported zero calories and no protein, fat, or carbohydrate in its canonical record. The parser accepts that record. Its basis can be confirmed, but its nutrition remains incomplete and the provider's zero energy is plainly unsuitable evidence of accurate honey nutrition. Validation/completeness improves usability; it is not a certification of label accuracy.

The embedded USDA dataset contained 13,345 parsed foods; 13,335 had all three macros and a per-100-g basis. Even the existing local dataset requires a completeness policy to make an absolute display guarantee.

### 7. The current result row displays energy, not a full macro breakdown

`FoodPicker.nutritionSummary` formats calories and a serving/100-g label. The search row does not render protein, carbohydrate, or fat even when those fields are present. If “always show macros” means seeing all three before opening a food, there is a separate presentation change in addition to enrichment reliability.

## Why the previous fixes could not eliminate the issue

Commit `70eedbb` added one follow-up bulk confirmation for the leading ten unresolved rows. Its documented fallback explicitly retained loading-on-open when confirmation failed. The current server gives incomplete lists only a one-minute cache lifetime, but the browser retains them without a TTL/reconfirmation policy. Commit `70f3325` improved barcode queueing; that addresses opening/scanning, not the bulk confirmation contract.

Open Food Facts currently documents limits of ten structured-search reads and fifteen product reads per minute per IP. NutritionApp's backend requests share its egress allowance. Per-row barcode hydration of an entire list would exhaust that product allowance quickly, while increasing bulk request frequency would violate the structured-search allowance. [Provider API guidance](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/index.md).

## Proposed mitigation, not implemented

For the requested outcome, adopt a **complete public search result** contract: confirmed quantity basis, valid finite nonnegative energy and protein/carbohydrate/fat, with genuine recorded zero accepted and missing values retained as unknown. Apply eligibility before merging/truncating so incomplete rows do not consume the result limit. Display calories and P/C/F using the same declared serving, otherwise the confirmed 100-g basis. Do not replace missing macros with zero or infer them from calories.

Improve retrieval behind that contract:

1. Return explicit per-code verification outcomes and retry timing. Distinguish temporary failure from missing/incomplete source data, and expose a factual list status/recovery action when no complete result is available.
2. Coalesce overlapping verification work, use durable confirmed products first, bound the queue against the request deadline, and release reservations cancelled before an HTTP request is sent. Preserve pacing for requests already sent. Honor upstream 429/Retry-After.
3. Track pending/failed/confirmed verification separately from query results. Retry cached unresolved rows on a bounded cooldown while relevant, without repeated requests on every render; cover all eligible rows in the existing bounded batch. Ensure stale responses cannot replace the active query.
4. Prefer complete records from another provider only when product identity is established, such as the same normalized GTIN. A similarly named food is an alternative the user may choose, not evidence for the exact product's missing nutrients.
5. Add coverage for initial bulk failure followed by recovery, cached-query reconfirmation, cancelled reservations, overlapping requests, 429/backoff, twelve unresolved rows, and a canonical calorie-only product. UI changes require the repository's full visual gate at 390/768/1440 in both themes.

For substantially less dependency on live Open Food Facts enrichment, maintain a searchable local catalogue imported from canonical exports, restricted to complete entries, with dated refreshes. The provider [recommends local hosting and export-based updates for substantial API traffic](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/index.md). This requires a separate ingestion/storage design and freshness policy; it still cannot supply an absent product or absent nutrients. It does not require pretending the search index's incorrect basis is authoritative.

## Feasibility trade-off

| Intended guarantee | Feasible? | Consequence |
| --- | --- | --- |
| Every displayed public search row has confirmed calories and P/C/F | Yes | Exclude incomplete/unresolved rows; allow fewer/no results and explain availability |
| Every matching product always appears immediately with complete macros | No, with these external sources | Outages, missing nutrients, quantity ambiguity, and missing products remain |
| Preserve all current matches while eliminating the placeholder entirely | No honest numeric guarantee | Some rows must remain unavailable, be withheld, or require user label/manual input |
| Greatly reduce verification failures while preserving broad coverage | Yes | Repair caching, queue cancellation, coalescing, bounded retries and explicit outcomes |
| Ensure every displayed number is correct on the package | No automatic guarantee | Source data can be wrong even when complete; package review remains meaningful |

Recommended next implementation: the complete-row display contract plus recovery/caching/queue repairs. Consider a local canonical catalogue if its added maintenance is justified by the required availability. Increasing timeouts alone is insufficient.

## Commands executed

```text
dotnet test tests/Nutrition.Tests.csproj --filter "FullyQualifiedName~FoodSearchTests|FullyQualifiedName~FoodBasisVerifyTests|FullyQualifiedName~FoodCatalogTests|FullyQualifiedName~FoodProviderGateTests|FullyQualifiedName~FatSecretProviderTests|FullyQualifiedName~UsdaBrandedProviderTests" --no-restore --logger "console;verbosity=minimal"
npm.cmd test -- --reporter=dot src/components/useSearchAsYouType.test.ts src/lib/foodVerification.test.ts src/lib/logFood.test.ts src/lib/foodBasket.test.ts
```

The temporary harness ran separately against the current API project. Live probes were public read-only requests, not regression-test fixtures or proof of production user-session behavior.
