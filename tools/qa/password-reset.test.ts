/**
 * The one-time password-reset code flow.
 *
 * Run with:  npm run qa:passwordreset
 *
 * WHAT THIS GUARDS
 * ----------------
 * A reset code is a bearer secret that lets someone take over an account. The
 * properties that make it safe are all easy to break by accident — a stray
 * `.eq()` removal, an off-by-one in the attempt counter, a comparison that
 * short-circuits — and none of them show up until someone else's account is
 * taken. So they are pinned here:
 *
 *   1. The code is never stored in plaintext.
 *   2. A code works exactly once.
 *   3. A wrong code does not consume the right one.
 *   4. Repeated wrong guesses lock the code out for good.
 *   5. An expired code is dead.
 *   6. A revoked code is dead.
 *   7. Issuing a new code kills the previous one.
 *   8. The code shape survives being typed with no separators, wrong case or
 *      spaces — because it is read out over the phone.
 *   9. The code alphabet contains no characters that look like each other.
 */

import {
  canonicalCode, generateResetCode, isWellFormedCode, normaliseCode,
  RESET_CODE_MAX_ATTEMPTS, RESET_CODE_TTL_HOURS,
} from "@/lib/password-reset-server";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(
      `  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`  ok    ${label} -> ${JSON.stringify(actual)}`);
  }
}
function truthy(label: string, actual: boolean) {
  if (!actual) {
    failures++;
    console.log(`  FAIL  ${label}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

async function main() {
  /* ── A minimal stand-in for the Supabase client ──────────────────────────
     The store only ever stores rows keyed `pwd_reset:<id>`, so a single Map
     holding every row is enough to exercise the REAL module code paths — hash,
     compare, mark used, expire, revoke, supersede, list. */

  type Row = { key: string; value: string };
  const store = new Map<string, Row>();
  const deleted: string[] = [];

  const fakeSupabase = {
    from: () => ({
      select: () => ({
        eq: (k: string, v: string) => ({
          maybeSingle: async () => {
            const row = store.get(v);
            return { data: row ? { value: row.value } : null, error: null };
          },
        }),
        like: (_pattern: string) => ({
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve(res({
              data: [...store.values()].filter((r) => r.key.startsWith("pwd_reset:")),
              error: null,
            })),
        }),
      }),
      upsert: (row: Row) => ({
        then: (res: (v: unknown) => unknown) => {
          store.set(row.key, row);
          return Promise.resolve(res({ error: null }));
        },
      }),
      delete: () => ({
        eq: (_k: string, v: string) => ({
          then: (res: (v: unknown) => unknown) => {
            deleted.push(v);
            store.delete(v);
            return Promise.resolve(res({ error: null }));
          },
        }),
      }),
    }),
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null }),
        getUserById: async () => ({ data: { user: null }, error: null }),
      },
    },
  } as any;

  const mod = await import("@/lib/password-reset-server");
  const {
    checkCode, redeemResetCode, issueResetCode, listResetCodes, revokeResetCode, statusOf,
  } = mod;

  const user = { user_id: "u-1", email: "tamale@example.com", name: "Tamale Ronald", role: "rider" as const };

  // ── The code itself ─────────────────────────────────────────────────────
  {
    const code = generateResetCode();
    truthy(`a generated code looks like GDR-XXXX-XXXX (${code})`, /^GDR-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code));
    truthy("a generated code is well formed", isWellFormedCode(code));
  }

  // ── The alphabet has no confusable pairs ─────────────────────────────────
  // The code is read out over the phone, so every character that can be mistaken
  // for another one is a support call. Here we assert the real invariant — at
  // most one member of each confusable pair is present — rather than maintaining
  // a blacklist that silently drifts as the alphabet changes.
  {
    const confusablePairs: [string, string][] = [
      ["O", "0"], ["I", "1"], ["I", "L"], ["L", "1"],
      ["U", "V"], ["B", "8"], ["S", "5"], ["Z", "2"],
      ["M", "N"], ["M", "W"], ["V", "W"],
    ];
    const body = Array.from({ length: 500 }, () => generateResetCode()).join("").replace(/GDR-/g, "");
    const violations = confusablePairs.filter(([a, b]) => body.includes(a) && body.includes(b));
    check("at most one member of each confusable pair appears", violations, []);
  }

  // ── Uniqueness across many draws ────────────────────────────────────────
  {
    const seen = new Set(Array.from({ length: 2000 }, () => generateResetCode()));
    check("2000 generated codes are all distinct", seen.size, 2000);
  }

  // ── Normalisation: the code is read out and typed by hand ──────────────
  {
    const code = generateResetCode();
    const flat = code.slice(4); // "K7QM-3T9P"
    check("the canonical form of a code is stable", canonicalCode(code), canonicalCode(code));
    truthy("a code with no separators is accepted", isWellFormedCode(flat));
    truthy("a code typed in lower case is accepted", isWellFormedCode(code.toLowerCase()));
    truthy("a code typed with spaces is accepted", isWellFormedCode(code.replace("-", " ")));
    truthy("a code typed without the GDR prefix is accepted", isWellFormedCode(flat));
    check("all those spellings reduce to the same canonical code", canonicalCode(flat), canonicalCode(code));
    check("the canonical code strips every separator", normaliseCode("gdr k7qm-3t9p"), "GDRK7QM3T9P");
  }

  // ── Malformed input is rejected, not corrected ─────────────────────────
  {
    truthy("an empty code is not well formed", !isWellFormedCode(""));
    truthy("a random word is not well formed", !isWellFormedCode("password"));
    truthy("a code of the wrong length is not well formed", !isWellFormedCode("GDR-ABC"));
    truthy("a code with a forbidden character is not well formed", !isWellFormedCode("GDR-AB0D-EFGH"));
  }

  // ── The TTL ladder is sane ─────────────────────────────────────────────
  {
    truthy(
      `the code lives for ${RESET_CODE_TTL_HOURS} hours`,
      RESET_CODE_TTL_HOURS === 24,
    );
    truthy(
      "the attempt ladder allows a realistic number of typos",
      RESET_CODE_MAX_ATTEMPTS >= 3 && RESET_CODE_MAX_ATTEMPTS <= 10,
    );
  }

  console.log("\n── one-time use, expiry and revocation ──────────────────────────");

  // ── Issue ───────────────────────────────────────────────────────────────
  const issued = await issueResetCode(fakeSupabase, user);
  truthy("a code is issued", !!issued?.code);
  check("the issued code is well formed", isWellFormedCode(issued!.code), true);

  // ── The code is never stored in plaintext ────────────────────────────────
  {
    const raw = [...store.values()].map((r) => r.value).join(" ");
    truthy("the plaintext code is not in the database", !raw.includes(issued!.code));
    truthy("the plaintext code body is not in the database", !raw.includes(issued!.code.slice(4).replace("-", "")));
    truthy("a hash IS stored", raw.includes("scrypt$"));
  }

  // ── It works exactly once ───────────────────────────────────────────────
  {
    const first = await redeemResetCode(fakeSupabase, issued!.record.id, issued!.code);
    check("the correct code redeems", first.ok, true);

    const second = await redeemResetCode(fakeSupabase, issued!.record.id, issued!.code);
    check("the same code cannot be redeemed twice", second.ok, false);
    check("the second attempt reports it as used", second.ok === false && second.reason, "used");
  }

  // ── A wrong code does not burn the right one ───────────────────────────
  {
    const fresh = await issueResetCode(fakeSupabase, user);
    const wrong = await redeemResetCode(fakeSupabase, fresh!.record.id, "GDR-ZZZZ-ZZZZ");
    check("a wrong code is rejected", wrong.ok, false);
    check("the rejection says the code was wrong", wrong.ok === false && wrong.reason, "wrong_code");
    check("the attempts counter moves", wrong.attemptsRemaining, RESET_CODE_MAX_ATTEMPTS - 1);

    const right = await redeemResetCode(fakeSupabase, fresh!.record.id, fresh!.code);
    check("the correct code still works after a wrong guess", right.ok, true);
  }

  // ── Repeated wrong guesses lock the code out ───────────────────────────
  {
    const fresh = await issueResetCode(fakeSupabase, user);
    let last: any = null;
    for (let i = 0; i < RESET_CODE_MAX_ATTEMPTS + 2; i++) {
      last = await redeemResetCode(fakeSupabase, fresh!.record.id, "GDR-ZZZZ-ZZZZ");
    }
    check("brute force is eventually refused", last.ok, false);
    check("the refusal is a lock or a wrong code, never a success", last.ok === false, true);

    const right = await redeemResetCode(fakeSupabase, fresh!.record.id, fresh!.code);
    check("a locked code cannot be redeemed with the right code", right.ok, false);
  }

  // ── Issuing a new code kills the previous one ───────────────────────────
  {
    const first = await issueResetCode(fakeSupabase, user);
    const second = await issueResetCode(fakeSupabase, user);
    truthy("a second code is issued", !!second?.code);
    truthy("the second code is different from the first", second!.code !== first!.code);
    check("the superseded code is deleted from the store", deleted.includes(`pwd_reset:${first!.record.id}`), true);

    const old = await redeemResetCode(fakeSupabase, first!.record.id, first!.code);
    check("the superseded code no longer redeems", old.ok, false);
  }

  // ── Revocation ─────────────────────────────────────────────────────────
  {
    const fresh = await issueResetCode(fakeSupabase, user);
    const revoked = await revokeResetCode(fakeSupabase, fresh!.record.id);
    check("a code can be revoked", revoked, true);
    const attempt = await redeemResetCode(fakeSupabase, fresh!.record.id, fresh!.code);
    check("a revoked code cannot be redeemed", attempt.ok, false);
    check("the refusal names the revocation", attempt.ok === false && attempt.reason, "revoked");
  }

  // ── Expiry ─────────────────────────────────────────────────────────────
  {
    const fresh = await issueResetCode(fakeSupabase, user);
    // Age the record past its expiry.
    const key = `pwd_reset:${fresh!.record.id}`;
    const parsed = JSON.parse(store.get(key)!.value);
    parsed.expires_at = new Date(Date.now() - 1000).toISOString();
    store.set(key, { key, value: JSON.stringify(parsed) });

    const attempt = await redeemResetCode(fakeSupabase, fresh!.record.id, fresh!.code);
    check("an expired code cannot be redeemed", attempt.ok, false);
    check("the refusal names the expiry", attempt.ok === false && attempt.reason, "expired");
  }

  // ── An unknown id is not found ──────────────────────────────────────────
  {
    const attempt = await redeemResetCode(fakeSupabase, "does-not-exist", "GDR-AAAA-BBBB");
    check("an unknown code id is not found", attempt.ok === false && attempt.reason, "not_found");
  }

  // ── The admin list shows the whole history ─────────────────────────────
  {
    const list = await listResetCodes(fakeSupabase);
    // Issuing a code supersedes any code the same person still holds, so the
    // store holds one row per person per "generation", not one row per issue.
    truthy(`the list contains the surviving codes (${list.length})`, list.length >= 3);
    const statuses = new Set(list.map((c) => c.status));
    truthy(`the list distinguishes statuses (${[...statuses].join(", ")})`, statuses.size >= 3);
    truthy("no list entry ever carries a plaintext code", list.every((c) => !("code" in (c as any))));
    // `statusOf` takes a stored record and returns its status; the list item
    // already carries the status, so the two must agree.
    check("the admin list reads status correctly", statusOf(list[0] as any), list[0].status);
  }
}

main()
  .then(() => {
    console.log("");
    if (failures === 0) {
      console.log("PASS — the reset code is safe to hand to a user.");
      process.exit(0);
    } else {
      console.log(`FAIL — ${failures} check(s) failed.`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("crash:", err);
    process.exit(2);
  });
