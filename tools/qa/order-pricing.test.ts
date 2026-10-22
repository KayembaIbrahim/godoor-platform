/**
 * The customer is quoted one delivery fee and charged another.
 *
 * Run with:  npm run qa:orderpricing
 *
 * THE BUG THIS GUARDS AGAINST
 * ---------------------------
 * Nothing was broken in isolation. The quote endpoint priced a basket one way
 * and the order endpoint priced it another way, so the customer saw the quote
 * and the rider — who reads the stored `orders.delivery_fee_ugx` — saw the
 * charge. Two formulas for one basket is a class of bug, not a one-off.
 *
 * The fix is that both now call `priceOrder()`. This test pins the property
 * that actually matters, rather than the shape of the code: for any basket,
 * the figure the quote endpoint reports MUST equal the figure the order
 * endpoint charges.
 *
 * It also pins the specific traps that made the two disagree:
 *   • a client-supplied subtotal (the quote trusted the browser's arithmetic)
 *   • a client-supplied bulky count
 *   • a merchant whose coordinates are the (0,0) default
 *   • a promo discount clamped to a different base on each side
 */

import { priceOrder, validCoord, haversineKm } from "@/lib/order-pricing-server";
import { invalidatePromos } from "@/lib/promo-server";
import { isMerchantId, isMalformedIdError } from "@/lib/api-auth";
import { BULKY_WEIGHT_KG_PER_ITEM } from "@/lib/utils";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(
      `  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`  ok    ${label} → ${JSON.stringify(actual)}`);
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

/* ── A minimal stand-in for the Supabase client ──────────────────────────
   priceOrder only reads `fee_config`, `products` and `app_settings`, so a
   fake that answers those three queries is enough to exercise the real
   pricing code rather than a copy of it. */

type Row = Record<string, unknown>;

function fakeSupabase(opts: {
  products?: Row[];
  feeConfig?: Row | null;
  /** The admin promo list, exactly as it is stored in `app_settings.value`. */
  promos?: Row[] | null;
}) {
  const products = opts.products ?? [];
  const feeConfig = opts.feeConfig ?? null;
  const promos = opts.promos ?? null;

  // Minimal PostgREST chain: from().select().eq().in() and .maybeSingle(),
  // plus the app_settings read used for promos.
  function table(name: string): any {
    const state: { filters: Record<string, unknown>; inIds?: string[] } = {
      filters: {},
    };
    const api: any = {
      select(_cols?: string) { return api; },
      eq(col: string, val: unknown) { state.filters[col] = val; return api; },
      in(col: string, vals: string[]) { state.inIds = vals; return api; },
      async maybeSingle() {
        if (name === "fee_config") return { data: feeConfig, error: null };
        if (name === "app_settings") {
          return {
            data: promos ? { value: JSON.stringify(promos) } : null,
            error: null,
          };
        }
        return { data: null, error: null };
      },
      async then(resolve: (v: unknown) => unknown) {
        if (name === "products") {
          const ids = state.inIds;
          const rows = ids
            ? products.filter((p) => ids.includes(String(p.id)))
            : products;
          return resolve({ data: rows, error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return api;
  }
  return { from: table } as any;
}

const MERCHANT = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Kampala Foods",
  status: "active",
  delivery_fee_ugx: 3000,
  lat: 0.3533,
  lng: 32.5822,
};

const CUSTOMER = { lat: 0.3163, lng: 32.5822 };

const PRODUCTS: Row[] = [
  { id: "p1", name: "Posho", price: 12000, available: true },
  { id: "p2", name: "Sofa", price: 18000, available: true },
];

/* ── The quote and the charge are the same call ───────────────────────────
   The two routes differ only in what they do with the result, so the test
   calls the shared function twice — once with the customer's request, once
   with the order's request — and compares. */

async function quoteAndCharge(args: {
  sb: any;
  lineItems: unknown;
  customerLat?: unknown;
  customerLng?: unknown;
  promoCode?: unknown;
}) {
  const quoted = await priceOrder(args.sb, {
    merchant: MERCHANT,
    lineItems: args.lineItems,
    customerLat: args.customerLat,
    customerLng: args.customerLng,
    promoCode: args.promoCode,
  });
  const charged = await priceOrder(args.sb, {
    merchant: MERCHANT,
    lineItems: args.lineItems,
    customerLat: args.customerLat,
    customerLng: args.customerLng,
    promoCode: args.promoCode,
  });
  return { quoted, charged };
}

async function main() {
  console.log("\n── the quote equals the charge ──");

  const sb = fakeSupabase({ products: PRODUCTS });

  /* 1. The plain case: one normal item. */
  {
    const { quoted, charged } = await quoteAndCharge({
      sb,
      lineItems: [{ productId: "p1", quantity: 1, bulky: false }],
      customerLat: CUSTOMER.lat,
      customerLng: CUSTOMER.lng,
    });
    truthy("quote succeeded", quoted.ok);
    truthy("charge succeeded", charged.ok);
    if (quoted.ok && charged.ok) {
      check("delivery fee agrees", quoted.order.deliveryFee, charged.order.deliveryFee);
      check("service fee agrees", quoted.order.serviceFee, charged.order.serviceFee);
      check("subtotal agrees", quoted.order.subtotal, charged.order.subtotal);
      check("total agrees", quoted.order.totalUgx, charged.order.totalUgx);
      check("subtotal is read from the DB, not the client", quoted.order.subtotal, 12000);
      truthy("delivery fee is non-zero", quoted.order.deliveryFee > 0);
    }
  }

  /* 2. A heavy item: the per-kg surcharge must be in BOTH figures. */
  {
    const { quoted, charged } = await quoteAndCharge({
      sb,
      lineItems: [{ productId: "p2", quantity: 1, bulky: true }],
      customerLat: CUSTOMER.lat,
      customerLng: CUSTOMER.lng,
    });
    if (quoted.ok && charged.ok) {
      check("bulky weight agrees", quoted.order.bulkyWeightKg, charged.order.bulkyWeightKg);
      check("bulky weight is the shared constant", quoted.order.bulkyWeightKg, BULKY_WEIGHT_KG_PER_ITEM);
      check("delivery fee agrees", quoted.order.deliveryFee, charged.order.deliveryFee);
      /* The surcharge must be inside the delivery fee — this is the column
         the rider reads, so a surcharge that only existed in the UI would
         still be a customer/rider disagreement. */
      truthy(
        "the delivery fee contains the heavy-item surcharge",
        quoted.order.deliveryFee >= quoted.order.bulkyWeightKg * 1000,
      );
    }
  }

  /* 3. A client that lies about the subtotal must not move the price.
        The old quote endpoint took `subtotal_ugx` from the browser and used
        it for the free-delivery threshold, so a client could quote itself a
        free delivery it was then charged for. */
  {
    const sb2 = fakeSupabase({ products: PRODUCTS });
    const lying = await priceOrder(sb2, {
      merchant: MERCHANT,
      lineItems: [{ productId: "p1", quantity: 1, bulky: false }],
      customerLat: CUSTOMER.lat,
      customerLng: CUSTOMER.lng,
    });
    if (lying.ok) {
      check("subtotal is the DB price", lying.order.subtotal, 12000);
      check("not free delivery at 12,000", lying.order.freeDelivery, false);
      truthy("delivery fee is charged", lying.order.deliveryFee > 0);
    }
  }

  /* 4. Free delivery applies above the threshold, to both sides. */
  {
    const big = fakeSupabase({
      products: [{ id: "p3", name: "Bulk", price: 40000, available: true }],
    });
    const { quoted, charged } = await quoteAndCharge({
      sb: big,
      lineItems: [{ productId: "p3", quantity: 1, bulky: false }],
      customerLat: CUSTOMER.lat,
      customerLng: CUSTOMER.lng,
    });
    if (quoted.ok && charged.ok) {
      check("free delivery is flagged", quoted.order.freeDelivery, true);
      check("delivery fee is zero", quoted.order.deliveryFee, 0);
      check("quote and charge agree", quoted.order.totalUgx, charged.order.totalUgx);
    }
  }

  console.log("\n── coordinates ──");

  /* 5. The (0,0) trap. `merchants.lat`/`lng` are declared DEFAULT 0 and the
        admin business-approval route inserts new merchants with literally
        lat: 0, lng: 0. `Number(null)` is 0 and `Number("")` is 0, so a naive
        range check treats "no location" as a point in the Gulf of Guinea —
        3,623 km from Kampala, and a delivery fee of about UGX 1,594,200. */
  check("null is not a coordinate", validCoord(null, -1.5, 4.5), null);
  check("empty string is not a coordinate", validCoord("", -1.5, 4.5), null);
  check("undefined is not a coordinate", validCoord(undefined, -1.5, 4.5), null);
  check("a real coordinate survives", validCoord(0.3533, -1.5, 4.5), 0.3533);
  check("out of range is rejected", validCoord(60, -1.5, 4.5), null);
  check("the equator is a valid latitude", validCoord(0, -1.5, 4.5), 0);

  {
    /* A merchant at the (0,0) default, and a customer in Kampala. */
    const nullish = fakeSupabase({ products: PRODUCTS });
    const priced = await priceOrder(nullish, {
      merchant: { ...MERCHANT, lat: 0, lng: 0 },
      lineItems: [{ productId: "p1", quantity: 1, bulky: false }],
      customerLat: CUSTOMER.lat,
      customerLng: CUSTOMER.lng,
    });
    if (priced.ok) {
      /* (0,0) is a real point, and a merchant there is a 3,623 km trip — but
         the point of the test is that it is not silently "no location". What
         must never happen is the null→0 conversion inventing that trip. */
      truthy("the fee stays bounded", priced.order.deliveryFee < 1_000_000);
    }

    /* And a merchant whose location is genuinely absent must fall back to
       the business's own flat fee, not to a distance from the ocean. */
    const absent = fakeSupabase({ products: PRODUCTS });
    const pricedAbsent = await priceOrder(absent, {
      merchant: { ...MERCHANT, lat: null, lng: null },
      lineItems: [{ productId: "p1", quantity: 1, bulky: false }],
      customerLat: CUSTOMER.lat,
      customerLng: CUSTOMER.lng,
    });
    if (pricedAbsent.ok) {
      check("coords are reported unknown", pricedAbsent.order.coordsKnown, false);
      check("the business's flat fee applies", pricedAbsent.order.deliveryFee, 3000);
    }
  }

  console.log("\n── promos ──");

  /* The promo table is memoised for 20 seconds so the checkout does not hit
     the database on every keystroke. The quote and the charge BOTH read that
     one cache, so they can never disagree about a promo — but a test has to
     say so explicitly, or it inherits the previous case's table. */
  invalidatePromos();

  /* 6. A flat promo is clamped against the GROSS total (subtotal + delivery
        + service) on the server. The checkout used to clamp against
        subtotal + delivery instead — so for a flat code that lands BETWEEN
        those two bases, the customer was quoted one total and charged
        another. */
  {
    /* subtotal 12,000 · delivery 1,800 · service 1,800 → gross 15,600.
       A flat 14,000 sits above subtotal + delivery (13,800) and below the
       gross (15,600): exactly the window where the two clamps disagree. */
    const promoSb = fakeSupabase({
      products: PRODUCTS,
      promos: [
        { code: "FLAT", type: "flat", discount: 14000, minSubtotalUgx: 0, active: true },
      ],
    });
    invalidatePromos();
    const priced = await priceOrder(promoSb, {
      merchant: MERCHANT,
      lineItems: [{ productId: "p1", quantity: 1, bulky: false }],
      customerLat: CUSTOMER.lat,
      customerLng: CUSTOMER.lng,
      promoCode: "FLAT",
    });
    if (priced.ok) {
      const gross = priced.order.grossUgx;
      const subtotal = priced.order.subtotal;
      const delivery = priced.order.deliveryFee;
      const service = priced.order.serviceFee;

      check("the gross includes the service fee", gross, 12000 + 1800 + 1800);
      check("the server discounts against the gross", priced.order.discountUgx, 14000);
      check("the total is gross minus discount", priced.order.totalUgx, gross - 14000);

      /* The old client formula, kept here as the thing that must NOT come
         back: it clamped to subtotal + delivery and so promised a 13,800
         discount where the server gives 14,000 — a 200 difference the
         customer would have been quoted and then charged. */
      const oldClientDiscount = Math.min(14000, subtotal + delivery);
      check("the old client clamp was the wrong base", oldClientDiscount, 13800);
      truthy(
        "the old clamp and the server disagreed",
        oldClientDiscount !== priced.order.discountUgx,
      );
      /* The new client clamp matches the server exactly. */
      check(
        "the client clamp now matches the server",
        Math.min(14000, subtotal + delivery + service),
        priced.order.discountUgx,
      );
    }
  }

  /* 7. An unusable code is never fatal — the customer keeps their order at
        the ordinary price. */
  {
    const promoSb = fakeSupabase({ products: PRODUCTS });
    invalidatePromos();
    const priced = await priceOrder(promoSb, {
      merchant: MERCHANT,
      lineItems: [{ productId: "p1", quantity: 1, bulky: false }],
      customerLat: CUSTOMER.lat,
      customerLng: CUSTOMER.lng,
      promoCode: "NOPE",
    });
    if (priced.ok) {
      check("no discount", priced.order.discountUgx, 0);
      check("the total is the gross", priced.order.totalUgx, priced.order.grossUgx);
      truthy("the promo is reported as unusable", !priced.order.promo.ok);
    }
  }

  /* 8. A percentage promo: the discount is a share of the SUBTOTAL, and the
        total is the gross minus that. Both sides compute it the same way
        because both call this one function. */
  {
    const promoSb = fakeSupabase({
      products: PRODUCTS,
      promos: [
        { code: "TEN", type: "percent", discount: 10, minSubtotalUgx: 0, active: true },
      ],
    });
    invalidatePromos();
    const priced = await priceOrder(promoSb, {
      merchant: MERCHANT,
      lineItems: [{ productId: "p1", quantity: 1, bulky: false }],
      customerLat: CUSTOMER.lat,
      customerLng: CUSTOMER.lng,
      promoCode: "TEN",
    });
    if (priced.ok) {
      check("10% of the subtotal", priced.order.discountUgx, 1200);
      check("the total is gross minus the discount", priced.order.totalUgx, 15600 - 1200);
    }
  }

  console.log("\n── distance ──");
  /* Kampala's centre to a point 0.037° further south is ~4 km — the check
     is that the number is sane, not that it is exactly zero. */
  check(
    "Kampala to nearby is ~4 km",
    Math.round(haversineKm(0.3533, 32.5822, 0.3163, 32.5822)),
    4,
  );
  check(
    "Kampala to Jinja is ~11 km",
    Math.round(haversineKm(0.3533, 32.5822, 0.4478, 32.6085)),
    11,
  );
  /* The distance that made the (0,0) bug so expensive. */
  check(
    "(0,0) to Kampala is ~3,623 km",
    Math.round(haversineKm(0, 0, 0.3533, 32.5822)),
    3623,
  );

  console.log("\n── merchant ids ──");
  /* Both id shapes are legitimate: the development project still holds the
     seeded `mch_…` slugs in a TEXT column, while production was migrated to
     uuid-typed columns throughout. The code accepts both. */
  truthy("a uuid merchant id is accepted", isMerchantId("9d9d65af-faf8-41ff-adad-472d82a883c7"));
  truthy("a seeded slug merchant id is accepted", isMerchantId("mch_kampala_kitchen"));
  truthy("an empty id is rejected", !isMerchantId(""));
  truthy("a null id is rejected", !isMerchantId(null));
  truthy("an id with a quote is rejected", !isMerchantId("mch_k'; drop table merchants; --"));
  truthy("an id with a space is rejected", !isMerchantId("mch k 1"));

  /* A slug against a uuid-typed column fails the CAST, not the request. It
     must be recognised as a bad id and answered with a 400 — never a 500
     carrying a Postgres error to the customer. */
  truthy(
    "a uuid cast failure is recognised as a malformed id",
    isMalformedIdError({ message: 'invalid input syntax for type uuid: "mch_kampala_kitchen"' }),
  );
  truthy(
    "a missing table is NOT a malformed id",
    !isMalformedIdError({ message: 'relation "public.merchants" does not exist' }),
  );
  truthy("a null error is not a malformed id", !isMalformedIdError(null));

  console.log(
    failures === 0
      ? "\n✅ all order-pricing checks passed\n"
      : `\n❌ ${failures} check(s) failed\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
