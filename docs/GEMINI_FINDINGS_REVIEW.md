# Gemini findings review — 16 October 2026

Reviewed the five findings in the user's pasted attachment, then implemented the valid changes during the scheduled 03:06 Asia/Kuala_Lumpur session. The user subsequently authorized committing and pushing these fixes to master.

| Finding | Verdict and implemented behavior |
| --- | --- |
| Ask AI opens an empty food search | Confirmed for ID-only proposals. The server now retains the food ID/name association from delivered tool evidence and fills `query` with the verified name. A barcode is never substituted as a food name. Ambiguous or missing associations require an explicit verified query. The existing client handler already consumes `query`; Open remains explicit and does not log food. |
| Shared-image conversion calls a callback for every byte | Confirmed. Decoding now writes into a preallocated byte array with an indexed loop. A 2 MB fixture verifies every byte and MIME metadata. The original claimed freeze durations, OOM frequency, and replacement timings were not measured; Base64 decoding and allocation still occur on the JavaScript thread. |
| Editing a provider food in a batch opens the manual form | Confirmed. Batch edits retain provider review, quantities, and portion controls. The per-item meal-time control is hidden in both editor branches; meal time remains a batch setting. Manual foods and AI estimates retain editable nutrition fields. |
| Recipes can enqueue an invalid serving weight | Confirmed for ratios outside 0.1–10,000 g even when both input fields are individually valid. Existing form validation already rejects empty/invalid inputs. The recipe now uses the shared portion validator for field feedback and again before enqueueing a mutation. Invalid drafts remain editable. |
| Equivalent metric/imperial descriptions become redundant portion labels | Confirmed. Pure amount labels such as `100g (3.5 oz)`, `30 GRM (30 g)`, and `240 ml (8 fl oz)` are suppressed. Household descriptions such as `cup (240 ml)` and `1 slice (30 g)` remain intact; no density conversion is introduced. |

The recipe investigation also confirmed that `JsonElement.TryGetDouble` throws for nonnumeric JSON kinds. Server portion validation now checks the kind first and returns a domain error for null, string, boolean, or object weights. The attachment's claim that those values simply return false, and its assumption of indefinite outbox retries, were incorrect.

## Verification

- Initial focused backend regressions: 9 failed, 5 passed, reproducing the defects before their fixes.
- Fixed focused backend regressions: 14 passed.
- `dotnet test tests/Nutrition.Tests.csproj --verbosity quiet`: 630 passed after updating the existing evidence-barrier fixture to include the verified name.
- `npm.cmd test`: 122 files, 584 tests passed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run check:standards`: passed.
- `npm.cmd run check:docs` and `node scripts/sync-docs.mjs --check`: passed.
- Production build, run by `npm.cmd run test:visual`: passed, including mobile bundle and precache budgets.
- Initial full browser run found that removing the batch exclusion also hid AI photo estimate nutrient fields. That run was stopped, the provider classification was corrected to keep AI estimates editable, and the affected scan workflow passed on rerun.
- A later broad run exposed an old batch test expecting the raw nutrition form and a saved-label review affected by the AI exclusion. The tests now expect provider quantities and preserve synchronous editor focus; AI estimates stay editable in the batch while an explicitly saved barcode-label food retains its normal review outside the batch. The real-touch Back test follows the same provider review contract.
- Targeted `npm.cmd run test:visual -- --grep 'mobile scan shortcut|reviewed food action|serving review, batch|compact batch, fresh'`: 15 passed. Includes both themes at 390/768/1440 px for batch review and invalid-recipe rejection/recovery, plus verified AI search and editable AI photo/label workflows. Batch-edit screenshots were visually inspected at all six size/theme combinations.
- Final expanded targeted browser run: 18 passed, adding multi-food batch focus/rescaling, saved barcode-label recovery, and real-touch Back navigation. The final frontend suite also passed again (584 tests).
- Final full `npm.cmd run test:visual`: **269 passed**, no failures or skips (26.9 minutes). Ran against isolated localhost ports 5185/5187/5188 and a dedicated development SQLite database. Includes real-touch browser navigation, provider batch editing, barcode-label recovery, offline flows, both themes, responsive layouts, and 200% text size. Log: `web/artifacts/gemini-findings/full-visual.log`; exit status: `0`.
- Final `git diff --check`: passed. The release commit is recorded in Git history.

Live AI/provider behavior, production deployment, signed APK packaging, and physical-device Android performance/crash behavior remain unverified.
