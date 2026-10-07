/**
 * Rider verification — tests against the REAL resolver in
 * src/lib/rider-verification.ts.
 *
 * The bug under test: the client decided "verified" from three signals
 * (riders row, verified merchant, approved documents) while the accept gate
 * read only `riders.verified`. A rider approved on documents therefore saw the
 * Boda board, tapped Accept, and got a 403. On top of that, `/app/rider`
 * auto-creates an unverified `riders` row, and the old verify route
 * short-circuited on it — so the auto-create permanently hid the evidence.
 */

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

process.env.ADMIN_SESSION_SECRET ||= "test-secret-not-used-in-production";

const { resolveVerifiedRider, riderVerificationStatus } = await import(
  pathToFileURL(new URL("../src/lib/rider-verification.ts", import.meta.url).pathname).href
);

/* ── A faithful PostgREST double ───────────────────────────────────────────── */

function makeClient(tables) {
  const calls = { inserts: [], updates: [] };
  const lookup = (table) => {
    if (!(table in tables)) return { data: null, error: { code: "42P01", message: `relation ${table} does not exist` } };
    return tables[table];
  };

  const sb = {
    __calls: calls,
    from(table) {
      let filters = {};
      let mode = "select";
      const api = {
        select(_cols) { return api; },
        eq(col, val) { filters = { ...filters, [col]: val }; return api; },
        ilike(col, val) { filters = { ...filters, [col]: val }; return api; },
        or() { return api; },
        order() { return api; },
        limit() { return api; },
        maybeSingle() {
          const t = lookup(table);
          if (t?.__missing) return Promise.resolve({ data: null, error: { message: "missing" } });
          const row = (t?.rows || []).find((r) =>
            Object.entries(filters).every(([c, v]) =>
              String(r[c]).toLowerCase().includes(String(v).toLowerCase()),
            ),
          );
          return Promise.resolve({ data: row || null, error: null });
        },
        then(resolve, reject) {
          const t = lookup(table);
          if (t?.__missing) return Promise.resolve({ data: [], error: { message: "missing" } }).then(resolve, reject);
          const rows = (t?.rows || []).filter((r) =>
            Object.entries(filters).every(([c, v]) => String(r[c]).toLowerCase().includes(String(v).toLowerCase())),
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
        insert(row) {
          mode = "insert";
          return {
            select: () => ({ maybeSingle: () => ({ then: (r) => r({ data: row, error: null }) }) }),
            then(resolve, reject) {
              calls.inserts.push({ table, row });
              (tables[table] ||= { rows: [] }).rows.push(row);
              return Promise.resolve({ data: row, error: null }).then(resolve, reject);
            },
          };
        },
        update(patch) {
          mode = "update";
          return {
            select: () => ({ maybeSingle: () => ({ then: (r) => r({ data: null, error: null }) }) }),
            eq(col, val) {
              return {
                then(resolve, reject) {
                  calls.updates.push({ table, patch, eq: { [col]: val } });
                  const t = (tables[table] ||= { rows: [] });
                  const hit = t.rows.find((x) => x[col] === val);
                  if (hit) Object.assign(hit, patch);
                  return Promise.resolve({ data: hit || null, error: null }).then(resolve, reject);
                },
              };
            },
          };
        },
      };
      void mode;
      return api;
    },
  };
  return sb;
}

let pass = 0;
async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

const VERIFIED_RIDER = { rows: [{ id: "u1", email: "rider@test.ug", verified: true }] };

console.log("\nA verified riders row is accepted as-is");
await t("resolves without touching the database", async () => {
  const sb = makeClient({ riders: { rows: [{ id: "u1", verified: true }] } });
  const r = await resolveVerifiedRider(sb, "u1", "rider@test.ug");
  assert.equal(r.verified, true);
  assert.equal(r.promoted, false);
  assert.equal(sb.__calls.updates.length, 0);
});

console.log("\nThe reported bug: approved on documents, no verified riders row");
await t("is promoted instead of being blocked with 403", async () => {
  const sb = makeClient({
    riders: { rows: [{ id: "u1", email: "rider@test.ug", verified: false }] },
    verification_documents: { rows: [{ user_id: "u1", status: "approved" }] },
    merchants: { rows: [] },
  });
  const r = await resolveVerifiedRider(sb, "u1", "rider@test.ug");
  assert.ok(r, "must resolve — this is what produced the silent 403");
  assert.equal(r.verified, true);
  assert.equal(r.promoted, true);
  assert.match(r.reason, /approved verification documents/);
});
await t("and the row is actually repaired", async () => {
  const sb = makeClient({
    riders: { rows: [{ id: "u1", verified: false }] },
    verification_documents: { rows: [{ user_id: "u1", status: "approved" }] },
  });
  await resolveVerifiedRider(sb, "u1", "rider@test.ug");
  assert.equal(sb.__calls.updates.length, 1);
  assert.equal(sb.__calls.updates[0].patch.verified, true);
});

console.log("\nPromotion via a verified merchant account");
await t("a verified merchant promotes the rider", async () => {
  const sb = makeClient({
    riders: { rows: [{ id: "u1", verified: false }] },
    merchants: { rows: [{ owner_id: "u1", verified: true }] },
    verification_documents: { rows: [] },
  });
  const r = await resolveVerifiedRider(sb, "u1", "rider@test.ug");
  assert.equal(r.verified, true);
  assert.match(r.reason, /merchant/);
});
await t("an UNverified merchant does not promote", async () => {
  const sb = makeClient({
    riders: { rows: [{ id: "u1", verified: false }] },
    merchants: { rows: [{ owner_id: "u1", verified: false }] },
    verification_documents: { rows: [] },
  });
  const r = await resolveVerifiedRider(sb, "u1", "rider@test.ug");
  assert.equal(r.verified, false);
});

console.log("\nSomeone who has genuinely not applied is still refused");
await t("no row, no documents, no merchant → not resolved", async () => {
  const sb = makeClient({
    riders: { rows: [] },
    merchants: { rows: [] },
    verification_documents: { rows: [] },
  });
  const r = await resolveVerifiedRider(sb, "nobody", "nobody@test.ug");
  assert.equal(r, null);
});
await t("pending documents do not promote", async () => {
  const sb = makeClient({
    riders: { rows: [{ id: "u1", verified: false }] },
    verification_documents: { rows: [{ user_id: "u1", status: "pending" }] },
  });
  const r = await resolveVerifiedRider(sb, "u1", "rider@test.ug");
  assert.equal(r.verified, false);
});
await t("rejected documents do not promote", async () => {
  const sb = makeClient({
    riders: { rows: [{ id: "u1", verified: false }] },
    verification_documents: { rows: [{ user_id: "u1", status: "rejected" }] },
  });
  const r = await resolveVerifiedRider(sb, "u1", "rider@test.ug");
  assert.equal(r.verified, false);
});

console.log("\nAnother rider's documents must never promote you");
await t("documents belonging to a different user are ignored", async () => {
  const sb = makeClient({
    riders: { rows: [{ id: "u1", verified: false }] },
    verification_documents: { rows: [{ user_id: "u999", status: "approved" }] },
  });
  const r = await resolveVerifiedRider(sb, "u1", "rider@test.ug");
  assert.equal(r.verified, false);
});

console.log("\nStatus view — the board a rider actually sees");
await t("approved on documents reports approved", async () => {
  const sb = makeClient({
    riders: { rows: [{ id: "u1", verified: false }] },
    verification_documents: { rows: [{ user_id: "u1", status: "approved" }] },
  });
  assert.equal(await riderVerificationStatus(sb, "u1", "rider@test.ug"), "approved");
});
await t("pending documents report pending", async () => {
  const sb = makeClient({
    riders: { rows: [{ id: "u1", verified: false }] },
    verification_documents: { rows: [{ user_id: "u1", status: "pending" }] },
  });
  assert.equal(await riderVerificationStatus(sb, "u1", "rider@test.ug"), "pending");
});
await t("the auto-created unverified row no longer hides a pending document", async () => {
  /* This is the exact poisoning bug: an unverified riders row used to
     short-circuit to "none" and the document below it was never consulted. */
  const sb = makeClient({
    riders: { rows: [{ id: "u1", verified: false }] },
    verification_documents: { rows: [{ user_id: "u1", status: "pending" }] },
  });
  assert.equal(await riderVerificationStatus(sb, "u1", "rider@test.ug"), "pending");
});
await t("a verified row reports approved without any other evidence", async () => {
  const sb = makeClient({ riders: { rows: [{ id: "u1", verified: true }] } });
  assert.equal(await riderVerificationStatus(sb, "u1", "rider@test.ug"), "approved");
});

console.log("\nEmail-keyed legacy rows");
await t("a row keyed only by email still resolves", async () => {
  const sb = makeClient({ riders: { rows: [{ id: "legacy-1", email: "old@test.ug", verified: true }] } });
  const r = await resolveVerifiedRider(sb, "auth-id", "old@test.ug");
  assert.equal(r.verified, true);
});
await t("email lookup is case-insensitive", async () => {
  const sb = makeClient({ riders: { rows: [{ id: "legacy-1", email: "old@test.ug", verified: true }] } });
  const r = await resolveVerifiedRider(sb, "auth-id", "OLD@Test.UG");
  assert.equal(r.verified, true);
});

console.log("\nA missing table must degrade, never throw");
await t("a database without verification_documents still works", async () => {
  const sb = makeClient({ riders: { rows: [{ id: "u1", verified: true }] } });
  const r = await resolveVerifiedRider(sb, "u1", "rider@test.ug");
  assert.equal(r.verified, true);
});
await t("a total schema miss resolves to null rather than throwing", async () => {
  const sb = makeClient({});
  const r = await resolveVerifiedRider(sb, "u1", "rider@test.ug");
  assert.equal(r, null);
});

console.log(`\n${pass} passed\n`);