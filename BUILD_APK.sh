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

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Bundle the (static) web assets into the Android project. The app loads
# https://godoor.site live in the WebView; web-app/ holds the launch page.
npx cap sync android

# Build APK using Gradle
echo "Building APK..."
export ANDROID_SDK_ROOT=$ANDROID_HOME
./gradlew assembleDebug

echo ""
echo "=== BUILD COMPLETE ==="
APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
  cp "$APK_PATH" "./GoDoor.apk"
  echo "APK saved to: ./GoDoor.apk"
  echo "Size: $(du -h GoDoor.apk | cut -f1)"
  echo "Install on Android: transfer GoDoor.apk to phone and open it"
else
  echo "ERROR: APK not found at $APK_PATH"
fi
