# Food diary implementation — verification paused

Implementation is prepared. At the user's request, no tests, typecheck, builds, browser checks, database migrations, commits, or deployment were run for this change. Existing concurrent edits were preserved; this document is not release evidence.

## Database and deployment preparation

- Apply the additive EF migration `20260909120000_DiaryEntryTime` using the existing database-admin migration workflow before deploying the new API. It adds nullable `Entries.Time`; old entries retain an unknown time. The migration and its target model are prepared, not applied.
- Set `Retention__MealDetailDays=90` explicitly on an existing deployment; a previous environment override of 7 would otherwise still win over appsettings. Keep the hourly cleanup schedule and temporary scan-image cleanup policy.
- Existing archived dates stay read-only and their summaries remain available. Extending retention cannot reconstruct deleted foods. Monitor existing storage warnings as more meal details accumulate.
- Development SQLite databases use `EnsureCreated`, which does not upgrade an existing schema. Use a fresh isolated test database for verification. To preserve an existing development diary, back it up and add nullable text column `Time` to `Entries` before starting the new API; do not reset a personal database.

## Deferred verification

The follow-up mobile-control change introduces shared `SegmentedControl` usage in Progress, WeightChart, Coach, food logging, and macro presets. Groups of up to three choices stay in one equal-width row; longer sets scroll horizontally on compact/medium screens. All choices share row height, including wrapped labels. Action rows also stretch buttons to matching heights. Existing modal and logging edits are preserved. The browser suite includes shared row-height, single-row, equal-width, and minimum-touch-height assertions; these additions have not been run.

After concurrent work is ready, run `dotnet test tests/Nutrition.Tests.csproj`, then in `web` run `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build`. Run `npm.cmd run test:visual` only against an isolated development API and database.

Check both themes at 390, 768, and 1440 px:

- Food navigation, date picker, previous/next/Today controls, mobile Settings access, wrapping food cards, keyboard focus, and touch targets.
- Midnight first, same-time foods beside each other, chronological ordering, and the separate legacy untimed group.
- Manual/saved/search/barcode/AI-reviewed time fields; edited times persist, recent-food logging defaults to now, and explicit copies preserve time.
- Quick Add with only calories, editable meal/time, null macros, offline save/reload/reconnect, duplicate prevention, and return to the originating diary date.
- The 90-day boundary, an already archived date inside that window, unknown archived nutrients, editable archived logging decisions, and retained conflicts after cutoff.
- Independent Weight/Energy year selections, effective-dated energy estimates, weight trend seeds, rapid navigation with delayed responses, account isolation, cached versus unavailable offline dates, and offline logging after midnight.

New regression sources are `tests/FoodDiaryTests.cs` and `web/src/lib/foodDiary.test.ts`. Existing browser selectors and the explicit seven-day compaction fixture are adjusted for the changed defaults; none have been executed.
