---
sessionId: session-260913-194352-awag
---

# Requirements

### Goal
Prevent food-search rows from presenting an unverified provider calorie value as `/ 100 g`, while preserving search availability when serving hydration fails.

### Scope
- Keep hydrated results unchanged: the example product displays `117 kcal / 30.4 g` and opens review at one 30.4 g serving.
- Mark the nutrition basis explicitly in the API contract so the UI can distinguish authoritative product data from an unhydrated Search-a-licious value.
- For an unverified result, keep name and Open Food Facts provenance visible but show concise basis-unavailable text rather than a calorie/unit claim; the existing click-through product lookup still resolves review details.
- Preserve the current ranking, cache, barcode, manual serving, energy-unit, and offline/error flows.
- Do not alter nutrient calculations or infer a serving from missing metadata.

### Acceptance Criteria
- A hydrated result for barcode `0748927065725` returns authoritative per-100 g nutrients, a 30.4 g portion, and 117 serving calories; its row reads `117 kcal / 30.4 g` (or the account-equivalent kJ value).
- If bulk hydration fails, the same search hit does not display `117 kcal / 100 g`; it displays a basis-unavailable state with its name and provenance.
- Selecting an unresolved coded result continues to invoke the existing barcode detail lookup and opens review with the resolved serving when available.
- A direct barcode result without a declared serving remains explicitly authoritative per 100 g and still displays `/ 100 g`.
- Existing uncommitted work in the affected web files is preserved.

# Technical Design

### Current Implementation
- [FoodSearchService.cs](air-file://hr6an1v8utsqe8dv3q4m/D:/App/NutritionApp/api/Services/FoodSearchService.cs?type=file&root=C%3A) reads Search-a-licious `_100g` fields, then attempts a bulk product hydration. Hydration failures are intentionally swallowed to keep search available.
- [FoodSearchTests.cs](air-file://hr6an1v8utsqe8dv3q4m/D:/App/NutritionApp/tests/FoodSearchTests.cs?type=file&root=C%3A) already records the exact provider discrepancy: the search index supplies 117 as `_100g`, while the product endpoint supplies about 384.87 kcal/100 g and 117 kcal/30.4 g.
- [FoodPicker.tsx](air-file://hr6an1v8utsqe8dv3q4m/D:/App/NutritionApp/web/src/components/FoodPicker.tsx?type=file&root=C%3A) currently treats every portionless result as authoritative `/ 100 g`.
- [LogFood.tsx](air-file://hr6an1v8utsqe8dv3q4m/D:/App/NutritionApp/web/src/components/LogFood.tsx?type=file&root=C%3A) already resolves a coded, portionless search result through the barcode endpoint before review.

### Key Decision
Add an explicit serialized nutrition-basis discriminator to `FoodResult` / `FoodSearchResult` (for example `per100g` versus `unverified`) rather than deriving trust from the presence of portions. A product endpoint can authoritatively provide per-100 g data without a serving, while a search-index hit can be unverified even though it uses a `_100g` field name.

```mermaid
graph LR
    S[Search-a-licious hit] -->|unverified| A[Food search API]
    P[Product hydration] -->|per100g + portion| A
    A --> F[FoodPicker summary]
    F -->|coded unresolved result| R[Existing review lookup]
```

### File Changes
- **Modify** [FoodSearchService.cs](air-file://hr6an1v8utsqe8dv3q4m/D:/App/NutritionApp/api/Services/FoodSearchService.cs?type=file&root=C%3A): extend `FoodResult` with the basis discriminator; mark raw search hits unverified, product/barcode reads authoritative, copy the authoritative basis during `ApplyHydratedProduct`, and version the hydrated search cache key so old entries cannot retain the former contract.
- **Modify** [FoodSearchTests.cs](air-file://hr6an1v8utsqe8dv3q4m/D:/App/NutritionApp/tests/FoodSearchTests.cs?type=file&root=C%3A): assert raw, hydrated, and direct-barcode basis states using the existing Optimum Nutrition fixture.
- **Modify** [types.ts](air-file://hr6an1v8utsqe8dv3q4m/D:/App/NutritionApp/web/src/types.ts?type=file&root=C%3A): add the matching discriminated basis field to `FoodSearchResult`.
- **Modify** [FoodPicker.tsx](air-file://hr6an1v8utsqe8dv3q4m/D:/App/NutritionApp/web/src/components/FoodPicker.tsx?type=file&root=C%3A): render serving summaries first, verified per-100 g summaries second, and concise basis-unavailable text for unresolved values.
- **Modify** [food-review.spec.ts](air-file://hr6an1v8utsqe8dv3q4m/D:/App/NutritionApp/web/e2e/food-review.spec.ts?type=file&root=C%3A): update mocked contracts and cover both hydrated and unverified rows through review.
- **Modify** [UI_UX_DESIGN_PRINCIPLES.md](air-file://hr6an1v8utsqe8dv3q4m/D:/App/NutritionApp/docs/UI_UX_DESIGN_PRINCIPLES.md?type=file&root=C%3A) and [UI_UX_EXTENSION_CHECKLIST.md](air-file://hr6an1v8utsqe8dv3q4m/D:/App/NutritionApp/docs/UI_UX_EXTENSION_CHECKLIST.md?type=file&root=C%3A): replace the assumption that every portionless search value is honest per 100 g with the explicit basis contract and required test coverage.

### Risks & Mitigations
- **Old in-memory cache entries:** bump the search cache namespace when the response contract changes.
- **Missing basis in stale/mock payloads:** handle an absent discriminator conservatively as unverified rather than restoring the false `/ 100 g` claim.
- **Concurrent UI edits:** make narrowly scoped changes around the formatter and type contract; do not overwrite the existing modifications in `FoodPicker`, `LogFood`, recipe, timeline, field, CSS, or documentation files.

# Testing

### Validation Approach
- Run `dotnet test tests/Nutrition.Tests.csproj` from the repository root.
- In the web workspace run `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build`.
- Run `npm.cmd run test:visual` against an isolated development API/database because the browser suite resets test accounts.

### Key Scenarios
- Raw Search-a-licious result: basis is unverified and no `/ 100 g` claim appears.
- Successfully hydrated Optimum Nutrition result: row and review agree on 117 kcal per 30.4 g.
- Failed bulk hydration followed by successful detail lookup: unresolved row is honest, then review uses the authoritative serving.
- Authoritative barcode product with no serving: `/ 100 g` remains available.
- Verify the affected search/review flow at 390, 768, and 1440 px in light and dark themes through the existing browser coverage.

# Delivery Steps

###   Step 1: Add authoritative nutrition basis to the food-search API
Food-search responses distinguish raw index values from authoritative product nutrients.

- Extend `FoodResult` in `api/Services/FoodSearchService.cs` with a serialized basis discriminator.
- Mark Search-a-licious reads as unverified and barcode/product reads as authoritative per 100 g.
- Propagate the hydrated basis in `ApplyHydratedProduct` and bump the search cache key version.
- Expand `tests/FoodSearchTests.cs` around the existing `0748927065725` fixture to verify raw, hydrated, and servingless barcode cases.
- Run the .NET test project after the API changes.

###   Step 2: Render honest search summaries and align UI contracts
Search rows never attach `/ 100 g` to an unverified calorie value, while existing review resolution remains intact.

- Add the basis discriminator to `FoodSearchResult` in `web/src/types.ts`.
- Update `nutritionSummary` in `web/src/components/FoodPicker.tsx` to prioritize declared servings, allow `/ 100 g` only for authoritative values, and show the selected basis-unavailable state otherwise.
- Update `web/e2e/food-review.spec.ts` mocks and assertions for hydrated, unverified, detail-resolution, and authoritative servingless results.
- Amend both UI/UX instruction documents with the explicit basis and fallback contract.
- Preserve all concurrent edits, then run typecheck, unit tests, build, and isolated visual/browser validation at the established responsive breakpoints and themes.