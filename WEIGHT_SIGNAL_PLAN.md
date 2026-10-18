# Weight signal and adaptive expenditure plan

Status: implemented 2026-09-29 (Coach 2.2.0, trajectory v6-robust-signal) except the items under "Remaining" below.

## Implemented

- Phase 1: `api/Domain/WeightSignal.cs` neighbour-median (Hampel) outlier filter with 1.4826·MAD noise; clean trend recomputed without flagged or marked days and used by coaching, the trajectory, and the Dashboard (`web/src/lib/weightSignal.ts`); weighted Theil–Sen on retained scale weights; endpoint slope over median dates with a noise-based disagreement limit.
- Phase 2: new context codes and per-code settle days (`tests/fixtures/weight-context.json`, mirrored and parity-tested on both sides); marked days excluded, following days down-weighted, reinstated after three confirming weigh-ins within a week, capped at 30% of window weigh-ins; check-in dialog summarises adjusted weigh-ins.
- Phase 3: prompt expectation carries a clear 14-day trend forward; direction-aware options; factual recent-intake line (not-logging days skipped, fasting counted as zero).
- Phase 4: `api/Domain/IntakeStep.cs` detects a sustained intake change (≥15%, ≥250 kcal/day, beyond two standard errors so alternate-day fasting does not trigger it); the estimate then uses only days after a seven-day settle period, or holds with an explicit reason until 14 settled days exist.

## Remaining

- Progress chart trend (`ProgressSummaryService` plus client projection) still uses the raw EWMA; switching needs both surfaces and their pending-projection tests updated together.
- Multi-select contexts and a modelled glycogen compartment (instead of the settle-window approach) were not implemented.
- F11 is addressed by unlogged-day estimation (see "Unlogged days — 2026-10-18"); confidence still uses the existing coverage factor.

Scope: how weigh-ins become a trend, how outliers and user-supplied context are handled, and how the trend feeds the adaptive expenditure estimate. Sources reviewed: `api/Domain/Expenditure.cs` (`WeightContextPolicy`, `WeightSignal`, `Expenditure`), `api/Domain/Coach.cs` (`Trend`, `Slope`, `Calculate`), `api/Domain/ExpenditureTrajectory.cs`, `web/src/lib/weightContext.ts`, `web/src/lib/format.ts` (`trend`), `web/src/components/Today.tsx`.

## What is already sound

- 28-day window, coverage/density/noise confidence, adaptive gain clamped to 8–30%, and explicit "Holding: …" reasons instead of guessing.
- Weekly target steps limited to ±100 kcal with a 50 kcal dead band; calorie floors take precedence.
- Theil–Sen slope (robust to single outliers) plus an endpoint cross-check that holds when a level shift may be inside the window.
- Unusual weigh-in prompt with optional context; only an explicit temporary context is excluded, and a context never maps directly to a calorie change.

## Findings

| # | Area | Finding | Effect |
|---|------|---------|--------|
| F1 | Outlier filter | Residuals are measured against an EWMA that already contains the point, and retained points keep EWMA values computed *with* flagged spikes. | A 2 kg bloat day is partly absorbed (harder to flag) and still leaks ~10%/day into the next week's retained trend values that the slope is fitted on. |
| F2 | Slope | Theil–Sen runs on EWMA-smoothed values (7-day half-life) instead of the retained scale weights. | Lag of roughly a week against a 28-day mean intake; smoothed points are autocorrelated, so the fit looks more certain than it is and responds late to real change. |
| F3 | Energy density | Every kg of change is valued at 7,700 kcal. | Glycogen/water shifts (start of a cut, refeeds, carb swings: 1–2 kg at ~1,000 kcal/kg effective) are read as fat change. Today the only defence is the 0.15 kg/week slope-disagreement hold, which also blocks adaptation during genuine change. |
| F4 | Context model | A temporary context removes exactly one day, all-or-nothing. | Sodium, alcohol, poor sleep, and hard training retain water for 1–3 days; the menstrual cycle for 3–7. Neighbouring days stay in the fit at full weight. |
| F5 | Context vocabulary | Codes: stress, bloating, menstrual cycle, illness, travel, other, genuine change, unsure. | Missing the factors you named: poor sleep, high sodium, high-carb/refeed, alcohol, hard training/soreness, constipation or late large meal, creatine start. Also nothing for sudden *drops* (low-carb day, heavy sweating, dehydration, stomach illness). |
| F6 | Prompt trigger | Compares against the 14-day median with a max(1 kg, 1.5%) threshold. Ignores trend slope and intake. | During a 0.7 kg/week cut the median lags ~0.7 kg, so real spikes are masked and normal lows are flagged. Your case, "weight jumps although calories were low", is never used as evidence. |
| F7 | Over-labelling guard | Temporary points stay excluded forever. | Marking every gain as "stress" makes the coach believe loss is on track and keeps cutting calories. No persistence check, cap, or visible count at check-in. |
| F8 | Noise scale | MAD is unscaled (no ×1.4826); threshold is 3·max(MAD, 0.3 kg). | Actual cut-off is about 2σ, stricter than it reads. Should be deliberate and documented. |
| F9 | Trend parity | Dashboard "Trend weight" (`Today.tsx` → `format.trend`) includes temporary-context weigh-ins; the coach's current weight excludes them. | Two different trend numbers for the same day. |
| F10 | Endpoint slope | Divides the median difference by a fixed 21 days. | Only correct if weigh-ins are spread evenly across both edge weeks; should use the median dates. |
| F11 | Unlogged days | Excluded from mean intake (already disclosed in the reason text). | Biased low when skipped days are high-intake days. Keep, but let the confidence reflect it (see Phase 4). |

## Implementation plan

Rules: write a regression test first for every behaviour change (`tests/`), bump `Coach.Version` and `ExpenditureTrajectory.AlgorithmVersion` once for the whole change, never rewrite applied migrations, and keep client mirrors under parity tests.

### Phase 1 — Robust trend and slope (server, `api/Domain`)
1. Extract a `WeightTrend` module: a Hampel-style filter against a centred rolling median of scale weights (±3 days), with noise = 1.4826·MAD, threshold k = 3, and a 0.3 kg floor (F1, F8).
2. Recompute the EWMA after removing flagged points; display and coaching share this cleaned trend (F1).
3. Fit Theil–Sen on the retained *scale* weights instead of EWMA values; keep the endpoint cross-check but use the median dates (F2, F10).
4. Tests: a single spike does not move the slope; a genuine step change is kept after persistence; lag test against a known linear series.

### Phase 2 — Context with decay and weights (server + web)
1. Extend `WeightContextPolicy` with per-code weight and decay days, e.g. sodium/alcohol/late meal 0.25 weight for 2 days; poor sleep/stress 0.5 for 1 day; hard training 0.5 for 2 days; menstrual cycle 0.25 for 5 days; illness 0 for 3 days; refeed/high-carb 0.25 for 3 days (F4). Use weighted Theil–Sen (weighted median of pair slopes).
2. New codes: `poor_sleep`, `high_sodium`, `high_carb`, `alcohol`, `hard_training`, `digestion`, `creatine`, `dehydration` (drop), `low_carb` (drop). Validation list, client options, and copy change together; multi-select only if storage allows it without a migration rewrite. Otherwise add a new migration (F5).
3. Persistence guard: when the median of the next ≥3 weigh-ins over 5–7 days stays within noise of the marked value, reinstate the point at full weight and say so in the check-in reason. Cap context down-weighting at 30% of window points (F7).
4. Check-in dialog: show "N weigh-ins adjusted for temporary factors" with the codes.

### Phase 3 — Smarter prompt (web `lib/weightContext.ts`, mirrored rules)
1. Expected weight = cleaned trend level + slope × days since the last point; residual threshold = max(0.6 kg, 3·σ_personal) (F6).
2. Direction-aware options: a spike offers retention causes, a drop offers depletion causes.
3. Intake evidence in the copy: "Up 1.4 kg while the last 3 days averaged 1,650 kcal (target 1,800)", which is factual and not a verdict.
4. Parity fixture shared by client and server so the prompt and the filter agree on what is unusual.

### Phase 4 — Glycogen-aware energy density (server)
1. Detect intake/carb step changes: 7-day mean intake or carbs changing ≥15% against the previous 7 days.
2. For 7 days after a step, down-weight weight change (or model a glycogen+water compartment of up to ~1.5% body mass at ~1,000 kcal/kg) instead of holding the whole estimate (F3).
3. Coverage-aware confidence: partial/unlogged days lower confidence instead of only reducing coverage (F11).

### Phase 5 — Parity and display
1. Dashboard and Progress trend use the same cleaned trend as the coach (F9); `format.trend` becomes a mirror with a parity test.
2. Update `CLAUDE.md` feature index and `README.md` methodology; run all gates listed in `CLAUDE.md`.

## Work split

The 06:00 companion session worked on `BODY_FAT_AI_PLAN.md`, so this session implemented both the server and client halves.


## Formula audit — 2026-10-14

Source and unit-test review plus web references; the .NET suite and browser tests were not run in this review environment.

| Area | Result |
| --- | --- |
| Resting energy (`Coach.Resting`) | Mifflin–St Jeor coefficients are correct (10·kg + 6.25·cm − 5·age, +5 male / −161 female). A systematic review found it the most reliable common equation (within 10% of measured for about 82% of non-obese and 70% of obese adults), with real individual error; hence the "starting estimate" wording and the adaptive correction. |
| 7,700 kcal/kg (`Expenditure`, `Coach`, `ExpenditureTrajectory`) | A blended constant. Hall et al. (Lancet 2011) give about 9,440 kcal/kg for fat and about 1,820 kcal/kg for lean mass, so the true value depends on composition and falls at the start of a deficit or in a bulk. Used consistently for observed expenditure and for rate-based targets. Kept: the 28-day window, intake-step detection and settle period bound the error. A composition-aware density remains unimplemented. |
| Glycogen and water | About 3 g water per g glycogen is the commonly cited ratio, so a carbohydrate change can move 1–2 kg in days (consumer-level sources; no primary study checked). The 3–7 day settle windows and the 15% / 250 kcal `IntakeStep` are the right order of magnitude. |
| Outlier filter, slope, trend | Hampel filter (3 × 1.4826·MAD with a 0.3 kg floor), weighted Theil–Sen and the 7-day half-life EWMA (about 9.4% per day) are standard robust choices and match the shared fixture. MacroFactor documents trend smoothing and manual deletion rather than a published outlier rule, so there is no external benchmark for the thresholds. |
| Context effect on calories | A context never adds or subtracts calories. It only excludes the marked day and down-weights the following settle days in the slope, so it changes the estimate only through those weights; the 30% cap and the three-weigh-in confirmation stop labels from hiding a real change. |
| Unusual-weigh-in prompt | The prompt direction was measured against a trend-carried expected value. After a gap on a steady cut the expected value sits below the last reading, so an entry lower than the last weigh-in could be labelled "up" and offer retention causes such as bloating. The cause list now follows the movement from the last weigh-in too; when the two disagree only neutral causes are offered and the copy shows the last weigh-in (`contextDirection` in `web/src/lib/weightContext.ts`). The server stores any valid code and does not check direction. |
| Remaining | Prompt threshold (max(1 kg, 1.5%)) and filter floor (0.9 kg) differ by design but are not documented together; composition-aware energy density; multi-select contexts. |

Sources: Hall et al., Lancet 2011 (PMC3880593); Frankenfield et al. systematic review of resting-energy equations (PubMed 15883556); MacroFactor help centre (weight trend).


## Unlogged days — 2026-10-18

Problem: unlogged days were dropped from mean intake while the weight slope still contained their effect, which implicitly ate them at the logged average. An untracked weekend eaten above the weekdays therefore read as a lower expenditure (about −400 kcal/day for 2,000 kcal weekdays and 3,500 kcal weekends at a true 2,500), lowering targets and compounding the pattern.

Implemented (`api/Domain/UnloggedIntake.cs`, Coach 2.4.0, trajectory v9-unlogged-days):

- Each unlogged window day counts at the current expenditure plus 7,700 × the cleaned trend's change from that morning to the next (interpolated between weigh-ins, clamped to 0–2× the estimate; no trend evidence means the estimate itself). MacroFactor documents estimating skipped days from the weight trend.
- Trend gap: mean trend change across unlogged days minus logged days, in kcal/day. When it is at least 250 kcal/day and two standard errors (≥3 unlogged and ≥7 logged days with trend evidence), the estimate does not move in the direction the remaining bias pushes (down for a hidden surplus, up for a hidden deficit) and the reason explains why.
- Recurring unlogged weekdays (≥4 days, ≥75% on one or two weekdays) are named when no gap is detected; logged days under half the window's median logged intake are reported as possibly partial. A past day with food can be marked Not fully logged.
- Simulated scenarios with a known true expenditure live in `tests/UnloggedDayScenarioTests.cs`: weekend surplus and deficit, random typical skips (unbiased, adaptive), a ten-day holiday (mostly recovered), long gaps (coverage hold), explicit fasting, partial days, and the documented limit below.

Limit: the 7-day-half-life trend attenuates a weekly cycle. A modest unlogged surplus without a next-morning water jump is indistinguishable from scale noise within 28 days and remains biased low; the reason names the weekdays instead. Imputing a direction from population studies (weekend overeating, under-reporting) would invent intake, so it is not done.

Sources: MacroFactor help centre (partially logged days; logging frequency: at least four days a week, estimated skipped days, holds when insufficient); Hall et al., Lancet 2011 (energy density).
