#!/bin/bash
# GoDoor APK Builder
# Run on a machine with JDK 17, Android SDK 36 (platform + build-tools 35.0.0)
# installed, and npm dependencies present.
#
# Produces a debug APK for https://godoor.site that wraps the web app in a
# WebView. It runs the postinstall hook first (see package.json) which pins
# every Capacitor plugin module to Java 17; without it `npm install` regenerates
# those modules at Java 21 and the Android build fails with
#   > No variants exist / Cannot find a Java installation matching languageVersion=21
#
# Usage: chmod +x BUILD_APK.sh && ./BUILD_APK.sh
set -e

echo "=== GoDoor APK Builder ==="
echo "This builds a debug APK that wraps https://godoor.site"

# --- Environment -----------------------------------------------------------
if [ -z "$ANDROID_HOME" ]; then
  if [ -d "$HOME/Android/Sdk" ]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  elif [ -d "/opt/android-sdk" ]; then
    export ANDROID_HOME="/opt/android-sdk"
  else
    echo "ERROR: $ANDROID_HOME not set and no SDK found at \$HOME/Android/Sdk or /opt/android-sdk"
    exit 1
  fi
fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"

echo "Android SDK: $ANDROID_HOME"
echo "Java: $(java -version 2>&1 | head -1)"

# Use the locally installed Gradle when it is available; the wrapper in
# android/gradlew also works (its distribution is cached), but `gradle` is
# picked up automatically by the PATH and keeps this script independent of the
# wrapper download step.
GRADLE=""
if command -v gradle &>/dev/null; then
  GRADLE="$(command -v gradle)"
elif [ -x "android/gradlew" ]; then
  GRADLE="android/gradlew"
fi
if [ -z "$GRADLE" ]; then
  echo "ERROR: neither gradle nor android/gradlew found on PATH"
  exit 1
fi
echo "Gradle: $GRADLE"

# --- Dependencies ----------------------------------------------------------
if [ ! -d "node_modules" ]; then
  echo "Installing npm dependencies (this also pins the Capacitor modules to Java 17)..."
  npm install
fi

# Bundle the (static) web assets into the Android project. The app loads
# https://godoor.site live in its WebView; android/web-app holds the launch page.
npx cap sync android

# --- Build -----------------------------------------------------------------
cd android || { echo "ERROR: android/ directory not found"; exit 1; }

# Root cause of the long tail of OOM/varianterror reports on small devices:
#   1. `kotlin.compiler.execution.strategy=in-process` ships globally, so the
#      Kotlin compiler shares the Gradle daemon's heap. Combined with AGP 8.13
#      + four Capacitor plugin modules each carrying their own `buildscript`
#      classpath for `com.android.tools.build:gradle:8.13.0` (a fresh ClassLoader
#      + native image per module), the daemon is killed mid-configuration.
#      That leaves a project half-configured, which produces the
#      "No variants exist" symptom rather than the obvious toolchain error.
#
#   The fix lives in android/gradle.properties (which wins over the global
#   ~/.gradle/gradle.properties and overwrites the CLI override):
#     - Xmx512m, MaxMetaspaceSize=192m, SerialGC
#     - Kotlin compiler runs in its own process (kotlin.compiler.execution.strategy=daemon)
#     - one worker, no parallelism
echo "Building APK..."
set +e
"$GRADLE" assembleDebug \
  --no-daemon \
  --max-workers=1 \
  --console=plain
GRADLE_EXIT=$?
set -e

echo ""
if [ $GRADLE_EXIT -ne 0 ]; then
  echo "=== BUILD FAILED (gradle exit $GRADLE_EXIT) ==="
  echo "A common cause is out-of-memory: lower org.gradle.jvmargs and kotlin"
  echo ".compiler.execution.strategy in android/gradle.properties, and close"
  echo "other apps that eat RAM."
  exit $GRADLE_EXIT
fi

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
  cp "$APK_PATH" "./../GoDoor.apk"
  echo "=== BUILD COMPLETE ==="
  echo "APK saved to: $(pwd)/GoDoor.apk"
  echo "Size: $(du -h ../GoDoor.apk | cut -f1)"
  echo "Install on Android: transfer GoDoor.apk to phone and open it"
else
  echo "=== BUILD COMPLETE BUT APK NOT FOUND ==="
  echo "Expected at: $APK_PATH"
  exit 1
fi
