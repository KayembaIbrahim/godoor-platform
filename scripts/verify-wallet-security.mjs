/**
 * Wallet security — tests against the REAL functions in src/lib/wallet-security.ts.
 *
 * Node 24 strips TypeScript natively, so this exercises the shipped code rather
 * than a re-implementation. The path alias is resolved by the loader below.
 */

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import Module from "node:module";

process.env.ADMIN_SESSION_SECRET ||= "test-secret-not-used-in-production";
process.env.NODE_ENV ||= "test";

/* Resolve the "@/lib/..." alias the same way the bundler does. */
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/lib/")) {
    request = new URL(`../src/lib/${request.slice("@/lib/".length)}.ts`, import.meta.url).pathname;
  }
  return originalResolve.call(this, request, ...rest);
};

const mod = await import(pathToFileURL(new URL("../src/lib/wallet-security.ts", import.meta.url).pathname).href);
const {
  validatePinFormat, hashPin, timingSafeEqual, issueSpendGrant, verifySpendGrant,
  b64url, unb64url, coseToJwk, parseAssertion, verifyAssertion, lockFor, isLocked,
} = mod;

let pass = 0;
const t = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === "function") return r.then(() => { pass++; console.log(`  ok  ${name}`); },
                                                   (e) => { console.error(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; });
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
};

console.log("\nPIN format validation");
t("rejects non-numeric", () => assert.equal(validatePinFormat("12a4").ok, false));
t("rejects too short", () => assert.equal(validatePinFormat("12").ok, false));
t("rejects too long", () => assert.equal(validatePinFormat("1234567").ok, false));
t("rejects repeated digits", () => assert.equal(validatePinFormat("1111").ok, false));
t("rejects ascending sequence", () => assert.equal(validatePinFormat("1234").ok, false));
t("rejects descending sequence", () => assert.equal(validatePinFormat("4321").ok, false));
t("rejects non-string", () => assert.equal(validatePinFormat(1234).ok, false));
t("accepts a normal PIN", () => assert.equal(validatePinFormat("4271").ok, true));
t("accepts 6 digits", () => assert.equal(validatePinFormat("427193").ok, true));

console.log("\nPBKDF2 hashing");
await t("same PIN + same salt → same hash", async () => {
  const salt = b64url(new Uint8Array(16));
  const a = await hashPin("4271", salt);
  const b = await hashPin("4271", salt);
  assert.equal(a, b);
});
await t("different salt → different hash", async () => {
  const a = await hashPin("4271", b64url(crypto.getRandomValues(new Uint8Array(16))));
  const b = await hashPin("4271", b64url(crypto.getRandomValues(new Uint8Array(16))));
  assert.notEqual(a, b);
});
await t("wrong PIN fails the comparison", async () => {
  const salt = b64url(new Uint8Array(16));
  const h = await hashPin("4271", salt);
  assert.equal(timingSafeEqual(h, await hashPin("4272", salt)), false);
});
await t("hash is not the plaintext", async () => {
  const salt = b64url(new Uint8Array(16));
  assert.notEqual(await hashPin("4271", salt), "4271");
});
await t("a stored hash never contains the PIN", async () => {
  const salt = b64url(new Uint8Array(16));
  assert.equal((await hashPin("4271", salt)).includes("4271"), false);
});

console.log("\nTiming-safe comparison");
t("identical strings compare equal", () => assert.equal(timingSafeEqual("abc123", "abc123"), true));
t("single-char difference is rejected", () => assert.equal(timingSafeEqual("abc123", "abc124"), false));
t("length difference is rejected", () => assert.equal(timingSafeEqual("abc", "abcd"), false));
t("empty strings compare equal", () => assert.equal(timingSafeEqual("", ""), true));

console.log("\nSpend grants");
await t("a fresh grant verifies for its owner", async () => {
  const g = await issueSpendGrant("user-1", "pin");
  assert.equal(await verifySpendGrant(g, "user-1"), "pin");
});
await t("bio grants report bio", async () => {
  const g = await issueSpendGrant("user-1", "bio");
  assert.equal(await verifySpendGrant(g, "user-1"), "bio");
});
await t("a grant is bound to its user", async () => {
  const g = await issueSpendGrant("user-1", "pin");
  assert.equal(await verifySpendGrant(g, "user-2"), null);
});
await t("a tampered payload is rejected", async () => {
  const g = await issueSpendGrant("user-1", "pin");
  const [payload, sig] = g.split(".");
  const forged = b64url(new TextEncoder().encode(JSON.stringify({ uid: "user-2", m: "pin", exp: Date.now() + 90000 })));
  assert.equal(await verifySpendGrant(`${forged}.${sig}`, "user-2"), null);
});
await t("an altered signature is rejected", async () => {
  const g = await issueSpendGrant("user-1", "pin");
  const dot = g.lastIndexOf(".");
  assert.equal(await verifySpendGrant(g.slice(0, dot) + ".deadbeef", "user-1"), null);
});
await t("a missing grant is rejected", async () => assert.equal(await verifySpendGrant(null, "user-1"), null));
await t("garbage is rejected", async () => assert.equal(await verifySpendGrant("not-a-grant", "user-1"), null));
await t("an expired grant is rejected", async () => {
  const g = await issueSpendGrant("user-1", "pin");
  const [payload] = g.split(".");
  const expired = b64url(new TextEncoder().encode(JSON.stringify({ uid: "user-1", m: "pin", exp: Date.now() - 1000 })));
  // Re-sign is impossible without the secret, so this must fail on signature too.
  assert.equal(await verifySpendGrant(`${expired}.${g.split(".")[1]}`, "user-1"), null);
});

console.log("\nbase64url");
t("round-trips arbitrary bytes", () => {
  const bytes = new Uint8Array([0, 1, 250, 255, 128, 64]);
  assert.deepEqual([...unb64url(b64url(bytes))], [...bytes]);
});
t("handles an empty buffer", () => assert.equal(unb64url(b64url(new Uint8Array(0))).length, 0));

console.log("\nCOSE → JWK");
t("parses an ES256 (P-256) key", () => {
  const x = new Uint8Array(32).fill(7);
  const y = new Uint8Array(32).fill(9);
  const cose = new Uint8Array([2, 0xf9, 0xff, 32, ...x, 32, ...y]); // kty=2 alg=-7 crv=-1
  const out = coseToJwk(cose);
  assert.ok(out, "should parse");
  assert.equal(out.alg, -7);
  assert.equal(out.jwk.kty, "EC");
  assert.equal(out.jwk.crv, "P-256");
  assert.equal(out.jwk.x, b64url(x));
  assert.equal(out.jwk.y, b64url(y));
});
t("parses an Ed25519 key", () => {
  const x = new Uint8Array(32).fill(3);
  const cose = new Uint8Array([1, 0xf8, 6, 32, ...x]); // kty=1 alg=-8 crv=6
  const out = coseToJwk(cose);
  assert.ok(out);
  assert.equal(out.alg, -8);
  assert.equal(out.jwk.kty, "OKP");
});
t("rejects an unknown key type", () => assert.equal(coseToJwk(new Uint8Array([9, 1, 1])), null));
t("rejects an unsupported curve", () => {
  const cose = new Uint8Array([2, 0xf9, 0x00, 32, ...new Uint8Array(64)]); // crv=0 (P-384)
  assert.equal(coseToJwk(cose), null);
});
t("rejects truncated input", () => assert.equal(coseToJwk(new Uint8Array([2])), null));

console.log("\nAssertion parsing");
t("rejects an empty response", () => assert.equal(parseAssertion({}), null));
t("rejects short authenticatorData", () =>
  assert.equal(parseAssertion({ clientDataJSON: b64url(new TextEncoder().encode("{}")), authenticatorData: b64url(new Uint8Array(10)), signature: b64url(new Uint8Array([1])) }), null));
t("accepts a well-formed response", () => {
  const out = parseAssertion({
    clientDataJSON: b64url(new TextEncoder().encode('{"type":"webauthn.get"}')),
    authenticatorData: b64url(new Uint8Array(37)),
    signature: b64url(new Uint8Array([1, 2, 3])),
    userHandle: "user-1",
  });
  assert.ok(out);
  assert.equal(out.userHandle, "user-1");
});

console.log("\nWebAuthn signature verification");
const RP = "godoor.site";
const ORIGIN = "https://godoor.site";
const CHALLENGE = "test-challenge-value";

async function makeKeyPair() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}
async function exportJwk(kp) { return crypto.subtle.exportKey("jwk", kp.publicKey); }

async function realAssertion(kp, { challenge = CHALLENGE, origin = ORIGIN, type = "webauthn.get", rpId = RP, flagBad = false } = {}) {
  const clientDataJSON = JSON.stringify({ type, challenge, origin });
  const rpHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)));
  const authData = new Uint8Array(37);
  authData.set(rpHash, 0);
  authData[32] = flagBad ? 0x00 : 0x05; // UP + UV
  new DataView(authData.buffer).setUint32(33, 7); // signCount
  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientDataJSON)));
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0); signed.set(clientHash, authData.length);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, signed));
  return { clientDataJSON, authenticatorData: authData, signature: sig };
}

await t("a genuine assertion is accepted", async () => {
  const kp = await makeKeyPair();
  const a = await realAssertion(kp);
  const out = await verifyAssertion(a, await exportJwk(kp), CHALLENGE, { rpId: RP, origins: [ORIGIN] });
  assert.equal(out.ok, true);
  assert.equal(out.newSignCount, 7);
});
await t("a wrong challenge is rejected", async () => {
  const kp = await makeKeyPair();
  const a = await realAssertion(kp, { challenge: "different" });
  const out = await verifyAssertion(a, await exportJwk(kp), CHALLENGE, { rpId: RP, origins: [ORIGIN] });
  assert.equal(out.ok, false);
});
await t("a wrong origin is rejected", async () => {
  const kp = await makeKeyPair();
  const a = await realAssertion(kp, { origin: "https://evil.example" });
  const out = await verifyAssertion(a, await exportJwk(kp), CHALLENGE, { rpId: RP, origins: [ORIGIN] });
  assert.equal(out.ok, false);
});
await t("a mismatched RP ID is rejected", async () => {
  const kp = await makeKeyPair();
  const a = await realAssertion(kp, { rpId: "evil.example" });
  const out = await verifyAssertion(a, await exportJwk(kp), CHALLENGE, { rpId: RP, origins: [ORIGIN] });
  assert.equal(out.ok, false);
});
await t("a registration ceremony is rejected at the assertion gate", async () => {
  const kp = await makeKeyPair();
  const a = await realAssertion(kp, { type: "webauthn.create" });
  const out = await verifyAssertion(a, await exportJwk(kp), CHALLENGE, { rpId: RP, origins: [ORIGIN] });
  assert.equal(out.ok, false);
});
await t("a missing user-present flag is rejected", async () => {
  const kp = await makeKeyPair();
  const a = await realAssertion(kp, { flagBad: true });
  const out = await verifyAssertion(a, await exportJwk(kp), CHALLENGE, { rpId: RP, origins: [ORIGIN] });
  assert.equal(out.ok, false);
});
await t("a tampered authenticatorData breaks the signature", async () => {
  const kp = await makeKeyPair();
  const a = await realAssertion(kp);
  a.authenticatorData[35] ^= 0xff; // inside the 37-byte signed region (signCount)
  const out = await verifyAssertion(a, await exportJwk(kp), CHALLENGE, { rpId: RP, origins: [ORIGIN] });
  assert.equal(out.ok, false);
});
await t("a tampered clientDataJSON breaks the signature", async () => {
  const kp = await makeKeyPair();
  const a = await realAssertion(kp);
  const parsedClient = JSON.parse(a.clientDataJSON);
  parsedClient.origin = "https://godoor.site"; // semantically same, byte-different
  a.clientDataJSON = JSON.stringify({ ...parsedClient, origin: `${ORIGIN} ` });
  const out = await verifyAssertion(a, await exportJwk(kp), CHALLENGE, { rpId: RP, origins: [ORIGIN] });
  assert.equal(out.ok, false);
});
await t("a different key's signature is rejected", async () => {
  const kp = await makeKeyPair();
  const other = await makeKeyPair();
  const a = await realAssertion(other);
  const out = await verifyAssertion(a, await exportJwk(kp), CHALLENGE, { rpId: RP, origins: [ORIGIN] });
  assert.equal(out.ok, false);
});
await t("malformed clientData is rejected", async () => {
  const kp = await makeKeyPair();
  const a = await realAssertion(kp);
  a.clientDataJSON = "not json";
  const out = await verifyAssertion(a, await exportJwk(kp), CHALLENGE, { rpId: RP, origins: [ORIGIN] });
  assert.equal(out.ok, false);
});

console.log("\nLockout ladder");
t("first two failures are forgiven", () => {
  assert.equal(lockFor(1), 0);
  assert.equal(lockFor(2), 0);
});
t("third failure starts the lockout", () => assert.ok(lockFor(3) > 0));
t("the lockout escalates", () => {
  assert.ok(lockFor(4) > lockFor(3));
  assert.ok(lockFor(5) > lockFor(4));
});
t("it never decreases past the cap", () => assert.equal(lockFor(50), lockFor(6)));
t("an unexpired lock is active", () =>
  assert.equal(isLocked({ locked_until: new Date(Date.now() + 60_000).toISOString() }), true));
t("an expired lock is not active", () =>
  assert.equal(isLocked({ locked_until: new Date(Date.now() - 60_000).toISOString() }), false));
t("no lock means not locked", () => assert.equal(isLocked(null), false));
t("a null lock is not locked", () => assert.equal(isLocked({ locked_until: null }), false));
t("a garbage lock date is not locked", () => assert.equal(isLocked({ locked_until: "soon" }), false));

console.log(`\n${pass} passed\n`);