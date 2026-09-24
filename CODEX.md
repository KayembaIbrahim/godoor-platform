# GoDoor — Codex / Vercel launch

## 1. Install & run

```bash
cd godoor
npm install
npm run dev
```

Open http://localhost:3000

## 2. Demo path (2 minutes)

1. `/wallet` → top up UGX 20,000 → **I approved — credit wallet**
2. `/app` → pick a merchant → add items
3. `/cart` → `/checkout` → **Pay from wallet**

## 3. Publish (Vercel)

```bash
npm i -g vercel
vercel
```

Or push to GitHub and import in Vercel.  
**No env vars required** for demo mode.

## 4. Live MoMo later

```
MOMO_PROVIDER=flutterwave
FLUTTERWAVE_SECRET_KEY=sk_...
```

## Stack

Next.js 15 · React 19 · Tailwind 3 · Zustand · Zod

## Brand

Orange **Go** + white **Door**. Footer: A ZentechX company.
