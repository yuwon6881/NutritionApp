# Mobile design principles (Android first)

Phones are the primary surface. This document narrows `UI_UX_DESIGN_PRINCIPLES.md` for the compact (<640 px) and medium (640–1023 px) tiers, with Android — the Capacitor app and installed Chrome PWA — as the reference platform. Where the two documents overlap, the general document owns tokens, components, and data honesty; this one owns how they behave in a hand.

## 1. One job per screen, obvious in one glance

- Each sheet or step has one primary action. It is the only `primary` button visible, and on compact/medium it sits full width in the thumb zone (sticky footer inside the sheet, returned to the flow while the on-screen keyboard is open).
- Shortcuts are not the primary path. In Log food, Quick add and Manual entry are calm `muted` buttons; search, recents, and the method tabs carry the weight.
- Remove chrome that repeats what the screen already says: a tab named Search does not need a visible "Food search" heading (keep it `sr-only` for structure), and a date header reads "Today · Tuesday, Sep 29", not an ISO string.
- A secondary line of copy earns its place by telling the person something they would otherwise get wrong. Descriptions that restate a label are hidden below 640 px: the Food Log page and timeline descriptions are hidden there, and its date field's label is announced but not shown beside the day strip.

## 2. Reachability and touch

- Every target is at least 44 px (48–58 px for the primary action and method tabs). Adjacent targets keep 8 px between them.
- The most likely action on a phone gets the biggest control. The barcode tab leads with a full-width "Scan barcode" card below 1024 px; typing digits is the fallback, and the small in-field camera icon returns only on expanded layouts. Exactly one of the two is displayed, so the accessible name stays unique.
- Photo inputs default to the camera and always offer "Choose from gallery" (`FileInput libraryOption`): `capture` alone hides the library on Android, which blocks logging a meal photographed earlier.
- Method choices with 3–4 options are a sunken track with a raised selected card, icon over label, never a native `<select>`.

## 3. Motion that explains, then gets out of the way

- Durations and easing come from the shared motion tokens. Lists rise in with a ≤28 ms stagger capped at eight items; tab panels cross-fade (`MotionPanel axis="fade"`); totals pop once when their inputs change.
- The Dashboard plays a one-time landing cascade per launch: cards rise in reading order, the calorie ring draws while its remaining figure counts down, macro bars grow, the This week bars grow day by day, and the trend sparkline draws in. Headline values render immediately; the ring's accessible name always carries the true numbers. The asynchronously connected steps card reveals its height and fades in when it arrives; the true values render immediately and the completed animation leaves no height or transform. Returning to the Dashboard uses the normal page transition only.
- Animations use `backwards` fill (or are cancelled on finish) so no transform outlives them. Reduced motion removes all of it — the global CSS rule for stylesheets, `useReducedMotion`/`useIntroProgress` for JS.
- Active work may show a spinner inside its own button. Idle states never loop.

## 4. Android platform features — used where they help

| Feature | Decision | Where |
| --- | --- | --- |
| Haptics (`lib/haptics.ts`) | **Used.** `selection` for tab changes, adding a recent food, barcode hits, card lift, swipe thresholds; `success` for a completed log or AI estimate; `warning` when a logging action fails. Native Haptics in Capacitor, `navigator.vibrate` in the PWA; silent under reduced motion or the Settings toggle. | Log food, diary, batch |
| Hardware/predictive Back | **Used.** Back unwinds popover → step → selection → sheet → page via `useBackLayer`/`Modal` history. | Everywhere |
| ML Kit barcode scanner | **Used** in the Android app with the in-page camera as fallback. | Barcode tab |
| Camera vs. gallery chooser | **Used.** Camera first, gallery one tap away. | AI photo/label |
| Edge-to-edge, safe areas, themed status bar | **Used.** Sheets and sticky footers add `env(safe-area-inset-bottom)`. | Shell, sheets |
| Push notifications | **Only for the weekly check-in reminder.** An "estimate ready" notification was rejected: AI scans take seconds, the draft is saved and resumes on return, and a new local-notification permission would cost more trust than it earns. | Settings |
| Live Updates / Xiaomi HyperOS island (Focus notifications) | **Not used.** They need native ongoing-notification code for long-running tasks (rides, timers). No NutritionApp task runs long enough to justify one. Revisit only for a genuinely long background job. | — |
| Share target (share a photo into the app) | **Candidate, not built.** Useful for logging a gallery photo from another app; requires manifest `share_target` and an Android intent filter. | — |

Add a platform feature only when it removes a step, prevents an error, or confirms something the person cannot otherwise perceive. Never add one for novelty.

## 5. Readable, not overwhelming

- One number is the hero per card (energy, batch total, quick-add calories at 2.2 rem). Supporting values sit at 0.74–0.8 rem with tabular numerals.
- Rows are cards with a single tap target, the name on line one, and portion/basis/source on line two. Macros appear as the compact `P · C · F` summary where the basis is known.
- Unknown stays `—`; a provisional AI value stays labelled as an estimate. Polish never changes a value's meaning.

## 6. Verification for mobile work

Check 360/390 px (compact) and 768 px (medium) in both themes, with real touch (`mobile-chromium`, Pixel 7) for gestures, Back, and the keyboard. Confirm the sticky primary action does not cover a focused field with the keyboard open, that nothing scrolls horizontally, and that reduced motion leaves every value visible at once.
