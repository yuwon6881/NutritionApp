# Android feature audit — 2026-10-03

This is a current source review of NutritionApp, with platform requirements checked against official Android and Xiaomi documentation. It is not physical-device or live-Firebase certification. No native integration was added by this audit.

The local `adb devices` check returned no attached devices. The installed Capacitor push plugin supports Android foreground notification display for the configured `presentationOptions: ['alert']`; foreground delivery still needs a real FCM/device test.

## Implemented capabilities

| Capability | Source evidence | Boundary |
| --- | --- | --- |
| Native barcode and product QR scanning | `web/src/lib/barcode/nativeScanner.ts`, `components/NativeBarcodeScanner.tsx`: bundled ML Kit, rear camera, camera permission, torch when supported, EAN/UPC and GS1 product-code parsing, stop on detection/close/error, browser camera fallback | Real camera accuracy, denied-permission recovery, background camera release and OEM behavior need handset tests. The native viewfinder does not constrain detection; see findings below. |
| Android push reminders | `lib/push/nativeNotifications.ts`, `push/deviceLifecycle.ts`, `notifications.ts`, `api/Services/NutritionPushSender.cs`: notification permission, FCM token registration/reconciliation/revocation, reminder channel, icon, notification tap routing, high-priority Android notification payload | Weekly Coach reminders only. Delivery depends on APK Firebase configuration, server credentials, schedule dispatch, system/channel permission and OEM policy. Source cannot establish actual delivery. |
| Touch feedback | `lib/haptics.ts`: Capacitor haptics, preference and reduced-motion handling | Requires device testing for actual strength and consistency. |
| Camera/gallery food and body photos | `components/ui/FileInput.tsx`, `LogFoodAiForm.tsx`: camera-first input with separate gallery choice, retained image drafts | Uses WebView file input rather than a dedicated Camera plugin. This is a valid integration; handset picker/process-loss behavior remains unverified. |
| Sharing out | `lib/share.ts`: native Share sheet for explicitly requested diary text, browser share/clipboard fallback | Does not accept incoming shared images/text. |
| Hardware Back, keyboard, theme | `lib/nativeApp.ts`, `lib/appHistory.ts`, `components/ui/Modal.tsx`: history-based dismissal, Dashboard-only exit, keyboard state, themed status bar, safe-area CSS | History tests establish navigation semantics, not native predictive-back gesture animations or Android inset behavior. |
| Offline shell and recovery | `web/capacitor.config.ts`, Android `MainActivity.java`, `lib/local.ts`, `useNourish.ts`, `components/ui/MobilePwa.tsx`: bundled assets, API routing, account-partitioned retained edits, foreground checks | Synchronization resumes with the app; no general native WorkManager background upload service was found. WebView storage durability under force-stop/process loss needs handset proof. |
| Health integration | `lib/googleHealth.ts`, Google Health API services and Settings | Cloud OAuth/provider integration, not direct Android Health Connect. Local Android health-store access is not implemented. |
| Quick entry | `web/vite.config.ts`, `lib/nutritionShortcuts.ts`: PWA Log food / Scan barcode / Log weight shortcuts | APK manifest has a launcher intent only; no native launcher shortcuts or app widget implementation was found. |
| Native privacy/build configuration | `AndroidManifest.xml`, backup/data-extraction rules, `web/android/variables.gradle`: backup and transfer excluded, camera optional, notification/camera permissions, target/compile SDK 36 | This review did not rebuild/install the APK or verify merged-manifest/runtime results. |

## Findings and prioritized improvements

1. **Native barcode frame mismatch.** `productCodeFromDetections` selects the first valid product code from the entire ML Kit batch; it does not inspect detection bounds or map them to the visible viewfinder. The browser scanner crops its decoding region. On a shelf, the native scanner can therefore choose a neighboring product despite the instruction to place a code inside the frame. Add native preview-coordinate/bounding-box filtering and multi-code device coverage; include GS1 QR codes and orientation changes. Keep one-scan review and manual fallback.
2. **Notification readiness is incomplete.** `checkNativeNotificationPermission` checks app-level permission; it does not inspect whether the reminder channel itself is disabled. Registration may succeed with an unusable channel. Add channel-aware status with a direct system Settings recovery action, then validate foreground/background/cold-start taps, permission withdrawal, token changes, Doze and Xiaomi restrictions on a physical phone. Avoid requesting blanket battery exemptions.
3. **Incoming photo sharing would remove a real step.** Add an Android `ACTION_SEND` image receiver and PWA share target into the existing retained AI photo draft/review flow. Validate MIME, size, account selection and explicit consent before sending images to the AI provider; never auto-log or auto-upload an incoming image.
4. **Native quick entry is a useful next step.** Expose Log food, Scan barcode and Log weight as APK launcher shortcuts using the existing shortcut dispatch contract. A later widget could show explicitly dated cached totals with an unknown/stale state and open existing flows; neither is implemented now.
5. **Device lifecycle evidence remains missing.** Explicitly test camera release/restart when backgrounding or locking, WebView picker cancellation, rotation, keyboard, gesture Back, process termination with retained edits and reconnect. Do not describe native predictive-back animations as proven from browser history tests.
6. **Health Connect is a separate product choice.** Direct Android health access could reduce cloud-provider dependence, but needs its own scopes, disclosure, provenance, deduplication and stream ownership. Preserve Nutrition's authoritative records and display-only steps; do not silently introduce another inbound weight stream.

## Android Live Updates and Xiaomi Super Island

No promoted ongoing notification permission, native Live Update builder, Xiaomi Focus/Super Island payload, Mi Push SDK, or island-specific capability handling was found.

[Android's current Live Update requirements](https://developer.android.com/develop/ui/views/notifications/live-update) require an ongoing, user-initiated, time-sensitive activity, native notification promotion, an eligible notification style and `POST_PROMOTED_NOTIFICATIONS`. The system/user/OEM can deny promotion. Android explicitly recommends widgets or Quick Settings for shortcuts and excludes ordinary alerts and upcoming events from Live Updates.

[Xiaomi's version documentation](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2141) distinguishes HyperOS 3 Super Island from HyperOS 2 Focus notifications. Its [integration procedure](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2132) includes developer registration, scenario review and notification-access approval; [the developer guide](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2131) describes native/template payloads and Mi Push extensions. Owning a compatible phone does not establish application approval or availability; test the actual device, OS/region and approved app configuration.

**Recommendation:** keep weekly reminders as normal notifications and diary totals as in-app UI or a future widget. A five-second Undo, barcode scan, short AI estimate, ordinary synchronization or static calorie ring does not justify an ongoing island. If a future feature introduces a real sustained user-started activity, evaluate its island eligibility then, implement a native lifecycle with explicit start/end/cancel and ordinary-notification fallback, and obtain Xiaomi approval. A fasting timer would be a new product feature requiring its own design and eligibility review, not something currently implemented.

## Handset acceptance checklist

The user identified their phone as **Xiaomi 14T Pro**. Installed Android/HyperOS build and ROM region are still unknown. [Xiaomi's global HyperOS 3 page](https://www.mi.com/global/hyperos/) lists this model; this does not confirm which update or island capability is installed on that particular phone. Prioritize ML Kit multi-code selection, notification channel/lock-screen settings, background delivery and gesture/keyboard behavior on that handset. Record the full Settings → About phone build before testing island eligibility.

- Scan one code and multiple nearby codes, GS1 QR, torch, camera denial, Back, background/lock/resume and rotation.
- Register reminders; verify channel disabled/app permission denied; receive and tap with app foreground/background/closed; revoke and switch accounts; check generic lock-screen copy.
- Verify offline food/weight edits and undo, retained image drafts after process death, keyboard safe areas, dark/light system bars and gesture Back.
- Record device model, Android/HyperOS version, APK build and each result. Build/browser success is separate from this evidence.

## Local verification and accompanying UI changes

The Undo host now uses Ayu card/border/shadow tokens, a compact informational icon, wrapping text and a 44 px secondary action. Weigh-in deletion first presents its recorded weight/date in the shared Modal, then uses the existing five-second held mutation and Undo mechanism. Cancel/Escape/Back preserve the weigh-in; cancel restores the trigger; confirmed deletion returns focus to Progress when the trigger disappears. Confirmation save failures stay in the dialog. Toast dates use the shared calendar-date formatter.

- `dotnet test tests/Nutrition.Tests.csproj`: 513 passed.
- `npm.cmd test`: 88 files / 423 tests passed at finalization.
- `npm.cmd run typecheck`, `check:docs`, `check:standards`, production build, guidance equality and `git diff --check`: passed.
- Final full `npm.cmd run test:visual` on an isolated local API/database with installed Chrome: all 197 passed, including the concurrent sign-in changes and deletion/Undo cases.
- Earlier focused `npm.cmd run test:visual -- auth-view.spec.ts weight-delete.spec.ts mobile-navigation.touch.spec.ts --output=test-results-undo-final`: all 15 passed, including the final wording/focus assertions.
- Confirmed 390/768/1440 light/dark, reduced motion, keyboard trapping/restoration, 44 px Undo targets, theme-token colors, no horizontal overflow, touch Back cancellation, Undo restoration and expiration/reload persistence. Rendered phone/tablet screenshots were inspected; final artifacts are under `web/test-results-undo-final/`.
- Offline precache allowance increased from 1176 to 1180 KiB for the new UI; final measured precache is 1177 KiB and initial-load JavaScript is 436 of the unchanged 437 KiB limit.

Unrelated concurrent sign-in edits were preserved. No commit, push, deployment, native integration change, APK rebuild, live-provider request or physical-device certification was performed.
