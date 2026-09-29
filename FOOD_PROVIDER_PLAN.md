# Food data provider plan

Status: planned, not implemented. Research date: 2026-09-29.

## Problem

Food search and barcode lookup depend on one provider, Open Food Facts (OFF). OFF is strong for
packaged products (and the only open source with meaningful Malaysian barcode coverage), but weak
for generic whole foods ("banana", "cooked white rice", "chicken breast"), restaurant items, and
common dishes. It also sheds load: search and product reads are per-IP rate limited behind our
single Cloud Run egress address, and during research on 2026-09-29 OFF returned "temporarily
unavailable" pages. MyFitnessPal and MacroFactor feel larger because they combine a curated
generic-food catalogue, a large branded/barcode database, and restaurant data.

All provider knowledge lives in `api/Services/FoodSearchService.cs` (561 lines): HTTP calls,
OFF JSON parsing, pacing, the `PublicFoodProduct` cache, hydration, ranking, and personalization
are interleaved, so adding or switching a provider today means editing that file throughout.

## Provider research

| Provider | Cost | Coverage | Limits / terms | Verdict |
|---|---|---|---|---|
| Open Food Facts (current) | Free, ODbL (attribution, share-alike for public derived DBs) | ~4M packaged products worldwide; best open source for MY packaged goods; weak generic foods | Search-a-licious unmetered; product API ~15 reads/min/IP; `/api/v2/search` 10/min/IP; nightly dumps (JSONL/CSV/Parquet) | Keep for barcodes and packaged search |
| USDA FoodData Central | Free, public domain (CC0) | Foundation (~7k) + SR Legacy (~8k) + FNDDS (~9k, survey dishes incl. many mixed dishes) generic foods; 2M+ US branded with `gtinUpc` | API key free via api.data.gov, 1,000 req/hour/IP; full bulk download (CSV/JSON) | **Add**: bundle generic foods locally (no network, no quota); use API branded search as a last barcode fallback |
| FatSecret Platform — Basic | Free, 5,000 calls/day | 2.3M+ verified foods (generic, branded, restaurant, supermarket); US dataset only on Basic | OAuth2 client credentials; server IP allowlist; "Powered by fatsecret" attribution required; caching permitted per edition table (confirm exact TTL in the terms before storing) | **Add** as the broad search provider; barcode lookup (`food.find_id_for_barcode`) if the Basic key allows it, else skip barcode on Basic |
| FatSecret — Premier Free | Free after verification | Unlimited calls; non-US datasets (Malaysia `MY` is a supported region) at reduced cost on application | Eligibility: start-ups (<US$1M revenue and funding), non-profits, students/researchers | Optional upgrade the owner can apply for; the provider must take `region` from configuration so it works unchanged |
| Edamam Food Database | Free Basic: 1,000 req/day, 50/min; Pro $0.00003/req | ~900k foods incl. 615k UPCs, NLP parsing | Attribution required | Not in phase 1; the provider interface must make it a drop-in later |
| Nutritionix | From ~US$1,850/month | Strong US restaurant/branded | Contract | Rejected (cost) |
| MyFCD (Malaysian Food Composition DB, MOH) | Web only | ~1,100 Malaysian foods | No public API, licence not stated | Rejected until a licence permits bundling; never scrape |

**Conclusion.** No single free provider beats OFF everywhere, but combining free sources does:
USDA generic foods (bundled, instant, unlimited) + FatSecret Basic (broad generic/branded/restaurant
search, 5k/day is far above a two-user diary's needs) + OFF (packaged and Malaysian barcodes).
Marginal cost stays $0. Combining is the right approach **only** with a merge layer that de-duplicates,
ranks, degrades gracefully per provider, and keeps one normalized result contract — which is also
what makes providers plug-and-play.

## Target architecture (API)

```
api/Services/Food/
  IFoodProvider.cs            interface + capabilities
  FoodProviderResult.cs       normalized provider-neutral record (see below)
  FoodCatalog.cs              orchestrator: fan-out search, barcode chain, merge, cache
  FoodResultMerger.cs         pure de-dup + ranking (unit-testable, no HTTP)
  ProviderGate.cs             generic pacing / quota / circuit breaker per provider (extracted from today's RateGate logic)
  Providers/
    OpenFoodFactsProvider.cs  moved from FoodSearchService (parsing, pacing, hydration unchanged)
    UsdaGenericProvider.cs    in-memory search over the bundled dataset
    UsdaBrandedProvider.cs    FDC API, barcode fallback only
    FatSecretProvider.cs      OAuth2 token cache + foods.search + barcode
  Data/usda-generic.json.gz   generated, embedded resource (see Data build)
tools/usda-import/            one-off generator script for the bundled dataset
```

### Contract

```csharp
[Flags] public enum FoodCapability { Search=1, Barcode=2 }
public interface IFoodProvider
{
    string Id { get; }                 // stable key: "off", "usda", "usda-branded", "fatsecret"
    string Attribution { get; }        // shown in Source, e.g. "Open Food Facts / ODbL"
    FoodCapability Capabilities { get; }
    Task<IReadOnlyList<FoodResult>> Search(string query,CancellationToken ct);
    Task<FoodResult?> Barcode(string gtin,CancellationToken ct);   // null = not found; throw FoodProviderUnavailable for outages/quota
}
```

- Providers return the **existing** `FoodResult` record (per-100 g basis, portions in grams, `Code`,
  `Basis`), so the HTTP response shape and the web client do not change. Add optional
  `ProviderId`/`ProviderFoodId` only if a provider needs a detail call; keep them server-side.
- A provider never throws `DomainException` user text; it throws a typed
  `FoodProviderUnavailable(providerId, retryAfter)`. `FoodCatalog` decides what the user sees.
- Registration: each provider is added in `Extensions`/`Program.cs` with its own named `HttpClient`,
  enabled/ordered by configuration, e.g.
  `"FoodProviders": { "Search": ["usda","fatsecret","off"], "Barcode": ["off","fatsecret","usda-branded"] }`.
  A provider without credentials is skipped with a startup log line, never a crash. Switching or
  adding a provider = new class + one registration line + config.

### Search flow

1. Validate query (unchanged 2–100 chars), check the shared memory cache keyed by the enabled
   provider set + query (bump the key version).
2. Fan out to every enabled search provider in parallel, each with its own timeout (~2.5 s) and
   circuit breaker. The bundled USDA provider always answers.
3. `FoodResultMerger`: normalize names, de-duplicate (same GTIN → keep the richer record; same
   normalized name + calories within 5% → keep the higher-priority provider), cap to ~20 results,
   rank with today's `PrioritizeResults` logic plus a provider-priority tie-break (generic foods
   first for short generic queries, branded first when the query contains a brand token).
4. Personalization (`RankForUser`) stays as-is on the merged list.
5. Partial failure: return what succeeded; only when **all** network providers fail and the local
   dataset has no match does the endpoint return today's 429/503 messages.

### Barcode flow

Sequential chain in configured order, stopping at the first hit: saved private mapping (unchanged)
→ `PublicFoodProduct` durable cache → OFF → FatSecret → USDA branded. 404 only when every
provider says not found; 503 when any provider was unavailable and none found it (so the client
keeps offering Retry). Normalize GTINs once (strip a leading zero from GTIN-14, try UPC-A as the
13-digit zero-padded form for providers that need it — FDC matches the 12-digit form).

### Caching

- Generalize `PublicFoodProduct` to key on `(ProviderId, Code)` with a new migration (never
  rewrite applied migrations); existing rows migrate to `ProviderId="off"`. Keep the existing
  expiry sweep in `StorageService`.
- Respect provider terms on how long data may be stored (confirm FatSecret's TTL before persisting;
  if unclear, memory-cache FatSecret results only).

### Data build (USDA generic foods)

- Script under `tools/usda-import/` downloads the FDC Foundation, SR Legacy and FNDDS bulk JSON,
  keeps name, kcal (Atwater-specific energy where present), protein, fat, carbohydrate, fiber, and
  household portions (`foodPortions` → label + grams), drops foods without energy, and writes a
  compact gzip JSON embedded in the API assembly (target < 3 MB). Record the FDC release date in
  the file. No invented nutrients: missing values stay null.
- `UsdaGenericProvider` loads it once (lazy singleton) and searches with the existing token
  normalization; results carry `Source = "USDA FoodData Central"` and `Basis = "per100g"`.

## Web client changes (small)

- `LogFoodBarcodeRecovery.tsx` hard-codes "Open Food Facts" in its titles; make them provider-neutral
  ("Barcode not found in the food databases", "Product data is incomplete", "Food databases are
  temporarily unavailable"). Coordinate with whoever owns that component at the time.
- Show the FatSecret attribution required by its terms ("Powered by fatsecret") wherever FatSecret
  results appear (result `source` line is sufficient if the terms allow; otherwise a footer under
  search results).
- No change to request/response shapes, outbox, or offline behaviour.

## Configuration and secrets

- `FoodProviders:FatSecret:ClientId`, `ClientSecret`, optional `Region` (empty on Basic).
  Register the Cloud Run egress IP in the FatSecret developer console IP allowlist.
- `FoodProviders:Usda:ApiKey` (api.data.gov key; DEMO_KEY only in development).
- Secrets via Secret Manager like `OpenAi:ApiKey`; trim whitespace the same way.
- Add each host to `ExternalCallMetricsHandler` provider naming.

## Tests (write first for behaviour changes)

- `FoodResultMerger`: de-dup by GTIN, by name+calories, ranking of generic vs branded, cap.
- `FoodCatalog`: one provider down → others still returned; all down → today's 503/429 message;
  barcode chain order, 404 vs 503 semantics, cache hit short-circuits.
- Each provider: JSON fixture parsing (per-100 g conversion, portions, missing nutrients stay null),
  FatSecret token caching/refresh, USDA 12-digit UPC matching and `gtinUpc` verification.
- Keep every existing test in `FoodSearchTests`, `FoodBarcodeTests`, `FoodSearchGateTests`,
  `FoodSearchPersonalizationTests` passing (they pin OFF pacing and ranking behaviour).
- Web: update any e2e copy assertions for the recovery titles; `npm.cmd run test:visual` for the UI change.

## Phases

1. Extract `IFoodProvider` + `FoodCatalog` + `OpenFoodFactsProvider` with **no behaviour change**
   (all existing tests green). Split `FoodSearchService.cs` along these seams (< 300 lines per file).
2. Add `UsdaGenericProvider` with the bundled dataset and the merger.
3. Add `FatSecretProvider` (search, then barcode) behind configuration.
4. Add `UsdaBrandedProvider` barcode fallback; generalize the `PublicFoodProduct` cache.
5. Provider-neutral recovery copy + attribution in the web client; update `CLAUDE.md` feature
   index and `README.md` sources.

## Owner actions (cannot be done by an agent)

- Create a FatSecret Platform account (Basic), add the Cloud Run egress IP, store the keys.
  Optionally apply for Premier Free to unlock unlimited calls and the Malaysia region.
- Request an api.data.gov key for USDA FDC.

## Sources

- FatSecret editions: https://platform.fatsecret.com/api-editions
- FatSecret platform overview: https://platform.fatsecret.com/platform-api
- FatSecret localization (MY supported, Premier only): https://platform.fatsecret.com/docs/guides/localization
- USDA FDC API guide and rate limits: https://fdc.nal.usda.gov/api-guide.html , https://calorieapi.com/blog/usda-fooddata-central-api-guide
- Edamam Food Database API: https://developer.edamam.com/food-database-api
- Open Food Facts data and licence: https://world.openfoodfacts.org/data
- Nutrition API price comparison: https://ymove.app/nutrition-api/compare
- MyFCD: https://myfcd.moh.gov.my/
