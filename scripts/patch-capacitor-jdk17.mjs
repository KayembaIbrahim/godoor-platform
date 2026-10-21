#!/usr/bin/env node
/**
 * Capacitor plugin modules ship with a Java 21 requirement, but the Android
 * toolchain available here is JDK 17 only.
 *
 * The plugin build files live in node_modules/, so `npm install` regenerates
 * them and wipes any manual edit. That is why this runs as a postinstall
 * hook: without it, the next `npm install` (or `npx cap sync`) puts the
 * project straight back into
 *
 *   > Cannot find a Java installation on your machine (Linux aarch64) matching:
 *   >   {languageVersion=21, vendor=any vendor, ...}
 *
 * and the Android build cannot resolve a toolchain, so the plugin module
 * produces no variants at all and the app fails with
 *
 *   > No matching variant of project :capacitor-android was found ...
 *   >   - No variants exist.
 *
 * What is rewritten:
 *   - compileOptions source/targetCompatibility: JavaVersion.VERSION_21 -> 17
 *   - kotlin { jvmToolchain(21) }              -> jvmToolchain(17)
 *
 * The script is idempotent and never fails the install: if the files are
 * already patched, or the layout changes upstream, it reports what it did
 * and exits 0.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every Gradle file that ships a Java 21 requirement. */
const TARGETS = [
  "node_modules/@capacitor/android/capacitor/build.gradle",
  "node_modules/@capacitor/geolocation/android/build.gradle",
  "node_modules/@capacitor/camera/android/build.gradle",
  "node_modules/@capacitor/filesystem/android/build.gradle",
  "node_modules/@capacitor/haptics/android/build.gradle",
  "node_modules/@capacitor/preferences/android/build.gradle",
  "node_modules/@capacitor/status-bar/android/build.gradle",
  "node_modules/@capacitor/local-notifications/android/build.gradle",
  "node_modules/@capacitor/push-notifications/android/build.gradle",
  "node_modules/@capacitor/clipboard/android/build.gradle",
  "node_modules/@capacitor/device/android/build.gradle",
  "node_modules/@capacitor/dialog/android/build.gradle",
  "node_modules/@capacitor/keyboard/android/build.gradle",
  "node_modules/@capacitor/network/android/build.gradle",
  "node_modules/@capacitor/splash-screen/android/build.gradle",
  "node_modules/@capacitor/app/android/build.gradle",
];

/** Replacements applied to each file, in order. */
const RULES = [
  {
    label: "compileOptions VERSION_21 -> VERSION_17",
    from: /JavaVersion\.VERSION_21/g,
    to: "JavaVersion.VERSION_17",
  },
  {
    label: "kotlin jvmToolchain(21) -> jvmToolchain(17)",
    from: /jvmToolchain\(\s*21\s*\)/g,
    to: "jvmToolchain(17)",
  },
];

let patchedFiles = 0;
let alreadyOk = 0;
let missing = 0;

for (const rel of TARGETS) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) {
    missing++;
    continue;
  }

  const original = readFileSync(abs, "utf8");
  let updated = original;
  const applied = [];

  for (const rule of RULES) {
    if (rule.from.test(updated)) {
      updated = updated.replace(rule.from, rule.to);
      applied.push(rule.label);
    }
  }

  if (updated === original) {
    alreadyOk++;
    continue;
  }

  writeFileSync(abs, updated, "utf8");
  patchedFiles++;
  console.log(
    `[cap-jdk17] patched ${rel} (${applied.join("; ")})`
  );
}

if (patchedFiles > 0) {
  console.log(
    `[cap-jdk17] ${patchedFiles} Capacitor Gradle file(s) pinned to Java 17.`
  );
} else {
  console.log(
    `[cap-jdk17] all present Capacitor Gradle files already target Java 17.`
  );
}

if (missing > 0) {
  console.log(
    `[cap-jdk17] ${missing} plugin module(s) not installed - skipped.`
  );
}
