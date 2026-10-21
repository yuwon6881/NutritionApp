#!/bin/sh
# Runs the connected Android tests on the booted emulator. A second attempt covers an emulator or WebView
# process crash that is not a test failure; it is announced as a warning so a flaky run stays visible.
# Logcat is saved either way, because the Gradle console only says "Process crashed".
cd "$(dirname "$0")/../android" || exit 1
adb logcat -c
./gradlew --no-daemon :app:connectedDebugAndroidTest
status=$?
if [ "$status" -ne 0 ]; then
  echo "::warning::Instrumentation failed on the first attempt; retrying once."
  adb logcat -d -t 3000 > app/build/logcat-first-attempt.txt
  adb logcat -c
  ./gradlew --no-daemon :app:connectedDebugAndroidTest
  status=$?
fi
adb logcat -d -t 3000 > app/build/logcat.txt
exit "$status"
