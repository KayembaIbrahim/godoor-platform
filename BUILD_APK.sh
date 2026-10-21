#!/bin/bash
# GoDoor APK Builder
# Run on an x86_64 machine with Android SDK installed
# Usage: chmod +x BUILD_APK.sh && ./BUILD_APK.sh

set -e

echo "=== GoDoor APK Builder ==="
echo "This builds a debug APK that wraps https://godoor.site"

# Check Java
if ! command -v java &>/dev/null; then
  echo "ERROR: Java not found. Install JDK 17+."
  exit 1
fi

# Check Android SDK
if [ -z "$ANDROID_HOME" ]; then
  if [ -d "$HOME/Android/Sdk" ]; then
    export ANDROID_HOME="$HOME/Android/Sdk"
  elif [ -d "/opt/android-sdk" ]; then
    export ANDROID_HOME="/opt/android-sdk"
  else
    echo "ERROR: Set ANDROID_HOME to your Android SDK path"
    exit 1
  fi
fi

echo "Using Android SDK: $ANDROID_HOME"
echo "Using Java: $(java -version 2>&1 | head -1)"

# aapt2: this project is built on ARM64 hosts, so the SDK's own aapt2 is used
# instead of the x86_64 one that ships inside the Maven artifact. PocketDev
# already points Gradle at it globally, but the flag is passed explicitly so
# the build also works on a machine without that global config.
AAPT2=""
if [ -x "$ANDROID_HOME/build-tools/35.0.0/aapt2" ]; then
  AAPT2="$ANDROID_HOME/build-tools/35.0.0/aapt2"
else
  AAPT2="$(ls -1 "$ANDROID_HOME"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1)"
fi
if [ -n "$AAPT2" ] && [ -x "$AAPT2" ]; then
  echo "Using aapt2: $AAPT2"
else
  echo "WARNING: no aapt2 found under $ANDROID_HOME/build-tools"
  AAPT2=""
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Bundle the (static) web assets into the Android project. The app loads
# https://godoor.site live in the WebView; web-app/ holds the launch page.
npx cap sync android

# Build APK using Gradle. The Gradle project lives in android/, so we must
# change into it first -- running ./gradlew from the repo root fails with
# "No such file or directory".
#
# MEMORY IS THE THING THAT ACTUALLY BREAKS THIS BUILD
# ----------------------------------------------------
# Two failure modes show up on a small machine and neither is obvious:
#
#   1. "Gradle build daemon disappeared unexpectedly" -- the daemon was
#      OOM-killed. The global ~/.gradle/gradle.properties ships
#      -Xmx512m, and because `kotlin.compiler.execution.strategy=in-process`
#      is also global, the Kotlin compiler runs INSIDE that 512m daemon.
#      512m cannot hold AGP 8.13 + the Kotlin compiler.
#
#   2. "Could not resolve project :capacitor-android ... No variants exist."
#      The Capacitor plugin modules declare Java 21 source/target
#      compatibility while only JDK 17 is installed, so AGP cannot build a
#      variant for them. Fixed by patching the plugin build files to 17.
#
# Gradle property precedence is: command line -D > user home gradle.properties
# > project gradle.properties. So the heap MUST be passed on the command line
# to beat the global 512m. Note the empty `-Dorg.gradle.jvmargs=` form does
# NOT do that -- it clears the heap entirely, which is worse.
echo "Building APK..."
export ANDROID_SDK_ROOT=$ANDROID_HOME
cd android || { echo "ERROR: android/ directory not found"; exit 1; }

# --no-daemon keeps a single JVM instead of a resident daemon plus a
# single-use fork; --max-workers=2 stops parallel workers from each
# reserving their own heap.
#
# `set -e` is disabled around the Gradle call so a non-zero exit is reported
# with Gradle's own message instead of aborting the script before the exit
# code can be inspected.
set +e
./gradlew assembleDebug \
  --no-daemon \
  --max-workers=2 \
  -Dorg.gradle.jvmargs="-Xmx1024m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8" \
  ${AAPT2:+-Pandroid.aapt2FromMavenOverride="$AAPT2"} \
  --console=plain
GRADLE_EXIT=$?
set -e

echo ""
if [ $GRADLE_EXIT -ne 0 ]; then
  echo "=== BUILD FAILED (gradle exit $GRADLE_EXIT) ==="
  echo "If the message is 'Gradle build daemon disappeared unexpectedly',"
  echo "the daemon was OOM-killed: lower org.gradle.jvmargs in"
  echo "android/gradle.properties and close other memory-hungry apps."
  exit $GRADLE_EXIT
fi

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
  cp "$APK_PATH" "./../GoDoor.apk"
  echo "=== BUILD COMPLETE ==="
  echo "APK saved to: $(cd .. && pwd)/GoDoor.apk"
  echo "Size: $(du -h ../GoDoor.apk | cut -f1)"
  echo "Install on Android: transfer GoDoor.apk to phone and open it"
else
  echo "=== BUILD COMPLETE BUT APK NOT FOUND ==="
  echo "Expected at: $APK_PATH"
  exit 1
fi
