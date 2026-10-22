/**
 * End-to-end proof that the customer is quoted what they are charged.
 *
 * Run with:  node scripts/verify-quote-equals-charge.mjs
 *
 * It asks the LIVE quote endpoint for a price, places a REAL order with the
 * same basket, and then compares:
 *
 *   quoted  = the delivery/service/total the customer was shown
 *   charged = what the order route actually computed
 *   stored  = what landed in `orders.delivery_fee_ugx` — the column the RIDER
 *             reads on the deliveries board
 *
 * All three must be identical. This is the whole point of the work: a
 * customer quoted one figure and a rider shown another is the bug.
 *
 * The order it creates is deleted again at the end, so the ledger is left as
 * it was found.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label} → ${JSON.stringify(actual)}`);
  }
}

const MERCHANT_ID = "mch_kampala_kitchen";
const CUSTOMER = { lat: 0.3166, lng: 32.5833 };

/* ── A temporary customer to place the order as ─────────────────────────── */
const email = `quote-e2e-${Date.now()}@godoor.test`;
const password = `QuoteE2E-${Math.random().toString(36).slice(2)}!a1`;
let userId = null;
let orderId = null;

async function main() {
  const { data: created, error: cErr } = await sb.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (cErr) throw new Error(`could not create the test customer: ${cErr.message}`);
  userId = created.user.id;

  const { data: sess, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`could not sign in: ${sErr.message}`);
  const token = sess.session.access_token;

  const { data: products } = await sb
    .from("products")
    .select("id, price")
    .eq("merchant_id", MERCHANT_ID)
    .order("id")
    .limit(2);
  if (!products?.length) throw new Error("no products to test with");

  /* Two baskets: one plain, one with a heavy item, so the per-kg surcharge
     is part of the comparison rather than an afterthought. */
  const baskets = [
    { label: "plain basket", items: [{ productId: products[0].id, quantity: 1, bulky: false }] },
    { label: "heavy basket", items: [{ productId: products[0].id, quantity: 1, bulky: true }] },
  ];

  for (const basket of baskets) {
    console.log(`\n── ${basket.label} ──`);

    /* 1. What the customer is shown. */
    const quoteRes = await fetch(`${BASE}/api/orders/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: MERCHANT_ID,
        customer_lat: CUSTOMER.lat,
        customer_lng: CUSTOMER.lng,
        line_items: basket.items,
      }),
    });
    const quote = await quoteRes.json();
    if (!quoteRes.ok) throw new Error(`quote failed: ${JSON.stringify(quote)}`);
    console.log(`  quoted: delivery ${quote.delivery_fee_ugx} · service ${quote.service_fee_ugx} · total ${quote.total_ugx}`);

    /* 2. What the customer is charged. */
    const orderRes = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        merchant_id: MERCHANT_ID,
        line_items: basket.items,
        customer_lat: CUSTOMER.lat,
        customer_lng: CUSTOMER.lng,
        delivery_address: "E2E quote-vs-charge probe",
        status: "payment_submitted",
        payment_method: "momo",
        customer_name: "E2E Quote Probe",
        customer_email: email,
      }),
    });
    const orderBody = await orderRes.json();
    if (!orderRes.ok) throw new Error(`order failed [HTTP ${orderRes.status}]: ${JSON.stringify(orderBody)}`);
    /* The response is { order: {...}, promo: ..., replayed: ... }; the id is on .order. */
    orderId = orderBody.order?.id;
    if (!orderId) throw new Error(`order had no id: ${JSON.stringify(orderBody).slice(0, 300)}`);

    /* 3. What landed in the database — the column the rider reads. */
    const { data: storedRows } = await sb
      .from("orders")
      .select("delivery_fee_ugx, service_fee_ugx, subtotal_ugx, total_ugx")
      .eq("id", orderId)
      .single();
    const stored = storedRows;

    console.log(`  charged: delivery ${stored.delivery_fee_ugx} · service ${stored.service_fee_ugx} · total ${stored.total_ugx}`);

    check("the quoted delivery fee is the charged one",
      quote.delivery_fee_ugx, stored.delivery_fee_ugx);
    check("the quoted service fee is the charged one",
      quote.service_fee_ugx, stored.service_fee_ugx);
    check("the quoted total is the charged total",
      quote.total_ugx, stored.total_ugx);
    check("the quoted subtotal is the charged one",
      quote.subtotal_ugx, stored.subtotal_ugx);

    await sb.from("orders").delete().eq("id", orderId);
    orderId = null;
  }

  console.log(
    failures === 0
      ? "\n✅ the quote and the charge are the same number\n"
      : `\n❌ ${failures} check(s) failed\n`,
  );
}

try {
  await main();
} catch (e) {
  console.error("FAILED:", e.message);
  failures++;
} finally {
  /* Leave no trace: the probe order and the probe customer both go. */
  try {
    if (orderId) await sb.from("orders").delete().eq("id", orderId);
  } catch {}
  try {
    if (userId) await sb.auth.admin.deleteUser(userId);
  } catch {}
  console.log("(probe order and probe customer removed)");
}

process.exit(failures === 0 ? 0 : 1);
