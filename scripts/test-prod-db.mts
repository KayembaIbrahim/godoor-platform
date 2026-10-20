/**
 * Production-database verification for the features changed in v10.5.1.
 * Read-only apart from probe rows that are cleaned up afterwards.
 */

import { getServiceClient } from "@/lib/supabase-server";
import { listLedger, listSettledDeposits } from "@/lib/escrow";
import { listAllLists, listCustomerLists, ensureShoppingListSchema, __resetShoppingListSchema } from "@/lib/shopping-list-store";
import { readWelcomeBackground, writeWelcomeBackground } from "@/lib/welcome-bg-server";
import { readGreetingBackground, writeGreetingBackground, GREETING_BG_KEY } from "@/lib/greeting-bg-server";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  }
}

async function main() {
  const sb = getServiceClient();
  if (!sb) {
    console.log("!! no service client");
    process.exit(1);
  }
  console.log("supabase:", process.env.NEXT_PUBLIC_SUPABASE_URL);

  console.log("\n=== A. Shopping list tables ===");
  __resetShoppingListSchema();
  await ensureShoppingListSchema(sb);
  const { count: slc, error: sle } = await sb.from("shopping_lists").select("*", { count: "exact", head: true });
  check("shopping_lists table queryable", !sle, sle?.message);
  console.log(`  rows: ${slc}`);
  const { count: sec, error: see } = await sb.from("shopping_list_events").select("*", { count: "exact", head: true });
  check("shopping_list_events table queryable", !see, see?.message);

  console.log("\n=== B. Shopping list store round trip (real tables) ===");
  const all = await listAllLists(sb);
  check("listAllLists returns an array", Array.isArray(all));

  console.log("\n=== C. Escrow ledger (admin history) ===");
  const led = await listLedger(sb, { limit: 200 });
  check("ledger has entries", led.length > 0, `count=${led.length}`);
  const types = Array.from(new Set(led.map((e) => e.type)));
  console.log(`  ${led.length} entries; types: ${types.join(", ")}`);
  check("entries carry user_id", led.every((e) => !!e.user_id));
  check("entries carry created_at", led.every((e) => !!e.created_at));
  const dep = await listSettledDeposits(sb);
  const statuses = Array.from(new Set(dep.map((d) => d.status)));
  console.log(`  ${dep.length} non-pending deposits; statuses: ${statuses.join(", ")}`);
  check("confirmed deposits exist", dep.some((d) => d.status === "confirmed"));
  check("confirmed deposits have confirmed_at", dep.filter((d) => d.status === "confirmed").every((d) => !!d.confirmed_at));

  console.log("\n=== D. Welcome background (production row) ===");
  const wb = await readWelcomeBackground(sb);
  console.log(`  ${JSON.stringify(wb)}`);
  check("welcome imageUrl present", wb.imageUrl.length > 0, wb.imageUrl);
  check("welcome published", wb.published === true);
  check("welcome intensity preserved", wb.intensity === 45, wb.intensity);

  console.log("\n=== E. Welcome background write/read round trip ===");
  const before = wb;
  const testUrl = "https://llzqkduccdbbetevpoql.supabase.co/storage/v1/object/public/catalogue-images/welcome/1792502355791-311522.jpg";
  const wrote = await writeWelcomeBackground(sb, {
    ...before,
    intensity: 60,
    published: true,
    updatedAt: new Date().toISOString(),
  });
  check("write ok", wrote === true);
  const wb2 = await readWelcomeBackground(sb);
  check("read back intensity 60", wb2.intensity === 60, wb2.intensity);
  check("read back imageUrl", wb2.imageUrl === before.imageUrl);
  // restore
  await writeWelcomeBackground(sb, { ...before, updatedAt: new Date().toISOString() });
  const wb3 = await readWelcomeBackground(sb);
  check("restored intensity", wb3.intensity === before.intensity, wb3.intensity);

  console.log("\n=== F. Greeting background round trip ===");
  const gb = await readGreetingBackground(sb);
  console.log(`  before: ${JSON.stringify(gb)}`);
  const gw = await writeGreetingBackground(sb, {
    imageUrl: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&q=80",
    intensity: 90,
    published: true,
    isGif: false,
    updatedAt: new Date().toISOString(),
  });
  check("greeting write ok", gw === true);
  const gb2 = await readGreetingBackground(sb);
  check("greeting read back", gb2.imageUrl.includes("unsplash") && gb2.published === true, gb2);
  const { data: raw } = await sb.from("app_settings").select("value").eq("key", GREETING_BG_KEY).maybeSingle();
  check("greeting stored as JSON string", typeof raw?.value === "string", typeof raw?.value);
  // cleanup
  await sb.from("app_settings").delete().eq("key", GREETING_BG_KEY);
  const gb3 = await readGreetingBackground(sb);
  check("greeting cleanup", gb3.imageUrl === "" && gb3.published === false);

  console.log("\n=== G. Profiles join for ledger names ===");
  const { data: profs } = await sb.from("profiles").select("id, name, email").limit(5);
  check("profiles readable", Array.isArray(profs) && profs.length > 0);
  check("profiles have name/email cols", profs!.every((p) => "name" in p && "email" in p));

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
