# Android reliability and signed APK distribution

## Renderer and camera recovery

The activity handles renderer termination separately from network errors. It detaches and destroys the terminated WebView and recreates a fresh Capacitor activity. Cookies, IndexedDB, retained account work and native incoming images remain intact. Camera scanning and the torch are stopped through the existing ML Kit adapter before renderer recovery. One automatic recreation is allowed per 60 seconds within the application process; another termination shows a native Retry screen. Whole-process death and force-stop remain separate startup recovery cases.

## Barcode targeting

`NutritionBarcodeScannerPlugin` extends the existing ML Kit plugin. It emits upright image corners plus the actual preview and WebView bounds. The web adapter accounts for center cropping, density and differing inset origins before comparing detection centers with the DOM viewfinder. Missing or invalid coordinates are ignored. Multiple candidates sort by distance from frame center, then product code. Existing EAN/UPC checks and GS1 QR parsing remain authoritative, and review still precedes logging.

The pinned scanner dependency needs a small rotation-dimension compatibility patch in `web/scripts/patch-barcode-coordinates.mjs`; `npm ci` applies it through `postinstall`. A changed upstream source fails the patch rather than silently applying an uncertain transform. The app registers its subclass after auto-loaded plugins so it owns the existing `BarcodeScanner` plugin name. Older APKs without the coordinate contract use the browser-camera fallback. Background/lock suspends scanning and disables the torch; return resumes only an open scanner and rechecks permission. Closing or failure restores the opaque page.

## Reminder readiness

`NutritionDevice.getReminderCapabilities` reads application permission, channel existence/importance/sound and available Settings destinations without changing token registration. Settings distinguishes Blocked, Available but silent, Enabled and Could not check, and rereads on foreground return. A missing channel uses the existing registration flow; a disabled channel links to Android settings. Channel muting does not revoke a valid token or request battery exemption. Reminder schedule, reconciliation and notification copy retain their existing contracts.

## Launcher shortcuts and shared photos

Static launcher shortcuts are generated from `nutritionShortcuts.ts` by `generate-android-shortcuts.mjs`; `android:sync` regenerates their XML. Cold and warm intents persist a native identity/time, import into the existing pending-action contract and acknowledge only after retention. The existing 30-minute lifetime and authentication/profile gates apply. A repeated native delivery cannot dispatch a consumed shortcut again. Shortcuts open existing food/barcode/weight entry flows and never create a record automatically.

`IncomingImageActivity` accepts one `ACTION_SEND` content stream and copies it immediately into private `noBackupFilesDir` storage. Actual decoded content must be JPEG, PNG or WebP and no larger than the existing decimal 20 MB limit. File paths, remote streams, multiple images, unsupported content, interrupted copies and excessive image dimensions are rejected. One published unassigned image is retained; replacing it requires confirmation. Unassigned images expire after 24 hours, with cleanup on access.

After sign-in/profile readiness the app asks for destination account, diary date and Meal photo or Nutrition label. The existing image preparation/compression path creates an account-scoped retained scan draft. The attachment transaction compares the exact draft version that was reviewed; a newer draft is preserved for another review. Keep existing discards the incoming photo; Replace is explicit. The native image is deleted only after durable attachment or explicit discard. Opening/sharing/attaching never requests analysis; Estimate my meal and Read nutrition label remain explicit editor actions. An already-open food editor must close before attachment so its autosave cannot replace the incoming draft.

## Installed version

Settings › This device names the web version and, in the Android app, the APK version and build. There is no in-app diagnostics disclosure or update check.

## Signed APK channels and releases

The application ID is `com.nutritionapp.mobile`. Debug APKs embed `device-test`; release APKs embed `release`. Keep existing keys unchanged within each channel. Each public repository GitHub Release tag (`android-device-test` or `android-release`) contains its APK and `android-release.json`.

The installed app does not read this metadata; updates are installed from the release page by hand, and uninstalling is never an update path.

Manifest schema 1 fields: `schemaVersion`, `applicationId`, `channel`, `versionName`, `versionCode`, `apkUrl`, `apkSha256`, `signingCertificateSha256`, `publishedAt`. CI adds `sourceCommit` and `sourceDirty`. The manifest is generated from the exact signed APK after verifying package/version, embedded channel and certificate.

Configure `ANDROID_RELEASE_SIGNING_CERT_SHA256` with the existing release fingerprint; device-test continues using `ANDROID_DEBUG_SIGNING_CERT_SHA256`. The manual release job waits for Android debug and API 24/33/36 instrumentation gates, then builds/tests a release APK alongside the AAB and uploads draft artifacts. Publication requires physical acceptance and explicit authorization. Native-only UI assets ship in the APK; the PWA loads them only on demand instead of precaching them. The shared entry allowance grows by 1 KiB and the PWA offline allowance by 4 KiB for the new dispatch/draft support.

## Verification and release acceptance

Run frontend typecheck, standards/docs checks, full tests/build and the full visual suite. `playwright.android.config.ts` separately exercises native UI contracts using a browser bridge fixture; it does not prove actual providers. Sync the tested build, compare bundled asset hashes and inspect merged manifests; run Android lint, JVM/instrumented tests and signature/package verification. Actual renderer termination is tested from API 29 and is skipped on API 24.

Record automated, emulator, physical-device and provider results separately. An emulator APK using a temporary/default debug key is not an upgrade candidate for a differently signed installation. Physical acceptance must record model, Android/OEM build, APK version/code and signing fingerprint, then verify:

- Nearby-product targeting, torch, permission withdrawal and lock/resume.
- Incoming Gallery sharing, existing-draft Keep/Replace, account/date confirmation and explicit analysis.
- Foreground/background/cold-start reminder taps with real provider delivery.
- Offline edits, airplane-mode cold launch, keyboard/insets, gesture and three-button Back.
- An in-place APK upgrade preserving pending work and the installed signing identity.

No Play publishing, auth redesign, widgets, direct Health Connect, background synchronization service or PWA share-target support is added.
