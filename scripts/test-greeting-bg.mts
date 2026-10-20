/**
 * Live round-trip test for the greeting-background publish path.
 *
 * This exercises the REAL server module (src/lib/greeting-bg-server.ts) against
 * the REAL production database, so it proves the exact code path the admin
 * "Publish" button uses actually persists and reads back.
 *
 * Run with:  node scripts/test-greeting-bg.mjs   (after esbuild bundling)
 */

import { getServiceClient } from "@/lib/supabase-server";
import {
  GREETING_BG_KEY,
  readGreetingBackground,
  writeGreetingBackground,
  clearGreetingBackground,
  normalizeGreetingBackground,
  sanitizeArtworkUrl,
  looksLikeGif,
} from "@/lib/greeting-bg-server";
import {
  readWelcomeBackground,
  writeWelcomeBackground,
  DEFAULT_WELCOME_BACKGROUND,
} from "@/lib/welcome-bg-server";
import {
  greetingForHour,
  greetingLine,
  resolveGreetingName,
  greetingSubtext,
} from "@/lib/greeting-core";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  }
}

async function main() {
  console.log("\n=== 1. Greeting time-of-day table ===");
  check("00:00 -> night", greetingForHour(0) === "night");
  check("04:59 -> night", greetingForHour(4) === "night");
  check("05:00 -> morning", greetingForHour(5) === "morning");
  check("11:59 -> morning", greetingForHour(11) === "morning");
  check("12:00 -> afternoon", greetingForHour(12) === "afternoon");
  check("16:59 -> afternoon", greetingForHour(16) === "afternoon");
  check("17:00 -> evening", greetingForHour(17) === "evening");
  check("21:59 -> evening", greetingForHour(21) === "evening");
  check("22:00 -> night", greetingForHour(22) === "night");
  check("23:59 -> night", greetingForHour(23) === "night");
  check("hour 25 wraps to 1 -> morning", greetingForHour(25) === "morning");
  check("NaN hour is safe", greetingForHour(Number.NaN) === "afternoon");

  console.log("\n=== 2. Name resolution ===");
  check("full name -> first word", resolveGreetingName("John Baptist Okello") === "John");
  check("email -> local part", resolveGreetingName("john@example.com") === "john");
  check("empty -> ''", resolveGreetingName("", "   ", null, undefined) === "");
  check("falls through to next candidate", resolveGreetingName("", "Jane Doe") === "Jane");
  check("line with no name", greetingLine("morning", "") === "Good morning");
  check("line with name", greetingLine("evening", "John") === "Good evening, John");
  check("subtext non-empty", greetingSubtext("night").length > 0);

  console.log("\n=== 3. URL sanitisation (XSS guard) ===");
  check("https ok", sanitizeArtworkUrl("https://cdn.example.com/a.jpg") === "https://cdn.example.com/a.jpg");
  check("javascript: rejected", sanitizeArtworkUrl("javascript:alert(1)") === "");
  check("data: rejected", sanitizeArtworkUrl("data:text/html,<script>") === "");
  check("http rejected", sanitizeArtworkUrl("http://cdn.example.com/a.jpg") === "");
  check("root-relative ok", sanitizeArtworkUrl("/brand/x.gif") === "/brand/x.gif");
  check("protocol-relative rejected", sanitizeArtworkUrl("//evil.com/x.jpg") === "");
  check("traversal rejected", sanitizeArtworkUrl("/../secret") === "");
  check("gif detected", looksLikeGif("https://cdn.example.com/a.GIF") === true);
  check("non-gif not detected", looksLikeGif("https://cdn.example.com/a.jpg") === false);

  console.log("\n=== 4. Normalisation ===");
  const normEmpty = normalizeGreetingBackground({ published: true });
  check("published without media -> false", normEmpty.published === false);
  check("empty imageUrl", normEmpty.imageUrl === "");
  const normFull = normalizeGreetingBackground({
    imageUrl: "https://cdn.example.com/a.gif",
    intensity: 140,
    published: true,
  });
  check("intensity clamped to 100", normFull.intensity === 100);
  check("isGif inferred", normFull.isGif === true);
  check("published true with media", normFull.published === true);

  const sb = getServiceClient();
  check("service client available", sb !== null);
  if (!sb) {
    console.log("\n!! No service client - cannot run DB round-trip.");
    process.exit(1);
  }

  console.log("\n=== 5. LIVE DB: greeting background write -> read ===");
  const before = await readGreetingBackground(sb);
  console.log(`  current stored record: ${JSON.stringify(before)}`);

  const testUrl = "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80";
  const wrote = await writeGreetingBackground(sb, {
    imageUrl: testUrl,
    intensity: 85,
    published: true,
    isGif: false,
    updatedAt: new Date().toISOString(),
  });
  check("write returned true", wrote === true);

  const after = await readGreetingBackground(sb);
  console.log(`  read back: ${JSON.stringify(after)}`);
  check("imageUrl survived the round trip", after.imageUrl === testUrl, after.imageUrl);
  check("intensity survived", after.intensity === 85, after.intensity);
  check("published survived", after.published === true);

  // Verify the raw column really is a JSON string (the bug that broke welcome-bg)
  const { data: raw } = await sb
    .from("app_settings")
    .select("value, key")
    .eq("key", GREETING_BG_KEY)
    .maybeSingle();
  check("row exists in app_settings", !!raw);
  check("value stored as JSON string", typeof raw?.value === "string", typeof raw?.value);
  console.log(`  raw column type: ${typeof raw?.value}`);

  console.log("\n=== 6. LIVE DB: welcome background (previously broken) ===");
  const welcome = await readWelcomeBackground(sb);
  console.log(`  welcome record: ${JSON.stringify(welcome)}`);
  check("welcome background reads without throwing", !!welcome);
  check("welcome has an image", welcome.imageUrl.length > 0, welcome.imageUrl);
  check("welcome published", welcome.published === true);

  console.log("\n=== 7. Restore greeting background to its prior state ===");
  if (before.imageUrl) {
    const restored = await writeGreetingBackground(sb, before);
    check("restored prior greeting record", restored === true);
  } else {
    const cleared = await clearGreetingBackground(sb);
    check("cleared test greeting record", cleared === true);
  }
  const final = await readGreetingBackground(sb);
  check("final state matches pre-test", final.imageUrl === before.imageUrl);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
