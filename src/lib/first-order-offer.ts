/**
 * First-order offer — single source of truth.
 *
 * The home banner advertises a headline percentage and the checkout honours a
 * promo code. Those are two numbers that must never disagree: a storefront
 * that shouts "40% OFF" and then applies 15% is a false pricing claim, and it
 * is the kind of thing that reaches Ugandan consumer-protection complaints and
 * payment-processor chargebacks rather than just an angry customer.
 *
 * So the banner, the claim button and the code that actually discounts all read
 * from this one object. Change `percent` here and both the advertised figure
 * and the honoured discount move together.
 *
 * ── This is the SHIPPED DEFAULT, not the live value ──────────────────────────
 * An admin can retune the offer from the portal (Promo Codes → FIRST20) without
 * a deploy, because the code is also a row in the `app_settings`-backed promo
 * table. The banner prefers that live value and falls back to this constant
 * whenever the store is unreadable — so a database hiccup shows ordinary prices
 * rather than an impossible discount.
 */
export const FIRST_ORDER_OFFER = {
  /** Headline figure shown on the banner AND applied at checkout. */
  percent: 20,
  /** The code the "Claim offer" button copies for the customer. */
  code: "FIRST20",
  /** Secondary line under the headline. */
  note: "Escrow protected • Free delivery",
  /** Headline, with `{percent}` substituted. */
  headline: "First order {percent}% OFF",
} as const;

export const firstOrderHeadline = (percent?: number): string =>
  FIRST_ORDER_OFFER.headline.replace("{percent}", String(percent ?? FIRST_ORDER_OFFER.percent));