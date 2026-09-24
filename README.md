# GoDoor — Kampala logistics + wallet

**GoDoor** (ZentechX) — hyper-local delivery for Uganda. Pay everything from a **GoDoor wallet** topped up with **MTN MoMo** or **Airtel Money** (phone + PIN only — no card).

## Product flows

1. **Browse** `/app` — merchants in Kampala (food, groceries, pharmacy, packages)
2. **Merchant** `/app/merchant/[id]` — add products to cart
3. **Cart** `/cart` — quantities, transparent fees
4. **Checkout** `/checkout` — pay from GoDoor wallet
5. **Wallet** `/wallet` — top up via MTN / Airtel, activity ledger

## Payment rules

- Client never sets balances
- Top-up credits only after confirm (demo) or signed webhook (live)
- Checkout calls `POST /api/pay` — fails with 402 if insufficient funds
- Currency: **UGX**

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind
- Zustand cart (persisted)
- In-memory wallet ledger for local demo (swap for Postgres in production)
- Mobile money abstraction in `src/lib/momo.ts`

## Run locally

```bash
cd artifacts/godoor
npm install
npm run dev
```

Open:

- http://localhost:3000 — landing  
- http://localhost:3000/app — order  
- http://localhost:3000/wallet — top up  

## Brand

- Wordmark: orange **Go** + white **Door** (speed lines)  
- **ZentechX** only in footer (“A ZentechX company”)  
- Purple `#5b21b6` · Orange `#f15a22` · Dark `#0b0712`

## Live mobile money

```bash
MOMO_PROVIDER=flutterwave   # or pesapal | xyle | mtn | airtel
FLUTTERWAVE_SECRET_KEY=     # server only — never NEXT_PUBLIC_
```

Wire provider HTTP in `src/lib/momo.ts`. Default is `demo` (no keys).
