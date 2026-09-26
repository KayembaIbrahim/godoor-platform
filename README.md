# GoDoor — Uganda’s nationwide super-app

**GoDoor** is a nationwide platform for businesses and people across Uganda. It combines online shopping, door-to-door delivery, and safe personal transport in one app: order what you need, move around your city, and pay locally with MTN MoMo, Airtel Money, or the GoDoor/Morse wallet.

Our ambition is simple: **make GoDoor the Grab-style super-app of Uganda.**

## What GoDoor does

### Shop and deliver

- Browse businesses and merchants across Uganda, not just Kampala.
- Discover food, groceries, pharmacy products, packages, documents, and other local services.
- Build a cart, pay securely, and track every delivery in real time on a live map.
- Give businesses online storefronts, merchant management, rider dispatch, payouts, promotions, and customer support tools.

### Move with GoDoor

- Request a **Boda** for safe motorcycle transport to your destination.
- Set pickup and dropoff points on the map, receive an upfront fare, follow the rider live, and complete the trip in the app.
- Support for **private car rides** is part of the same mobility vision: customers can choose a car when they prefer comfort, privacy, or travel with company.
- Verified drivers can accept requests, manage trips, and earn through GoDoor’s shared dispatch platform.

### Pay your way

- Top up the GoDoor/Morse wallet with **MTN MoMo** or **Airtel Money**.
- Pay for shopping, deliveries, and rides from one balance.
- Use direct mobile money or cash where supported.
- Review transactions, trip history, delivery history, and wallet activity in the app.

## Main app areas

| Area | Route | Purpose |
| --- | --- | --- |
| Customer marketplace | `/app` | Search businesses, browse products, and order |
| Merchant storefront | `/app/merchant/[id]` | View a business and add products to the cart |
| Cart | `/cart` | Review items, fees, and quantities |
| Checkout | `/checkout` | Choose a payment method and place an order |
| Order tracking | `/tracking` | Follow the delivery rider and route live |
| Boda and mobility | `/ride` | Request rides and follow active trips |
| Orders | `/orders` | View delivery history and active orders |
| Wallet | `/wallet` | Top up, pay, and review transactions |
| Business portal | `/business` | Manage products, orders, riders, and payouts |
| Rider portal | `/rider` | Accept deliveries and ride requests, share live GPS, and track earnings |
| Partner onboarding | `/partner` | Apply to join as a merchant or rider/driver |

## Live maps and navigation

GoDoor’s order and trip experiences are built around live movement rather than static markers:

- Actual road routes use **Mapbox Directions**, with an **OSRM fallback** and a clearly identified straight-line fallback.
- Customers can see pickup, destination, rider position, route progress, distance, and ETA.
- Riders can share live GPS positions that appear as moving markers on the customer’s map.
- Map picking and address search support pickup and delivery locations.
- Active deliveries and trips are subscribed to realtime updates where available.

Production map features require `NEXT_PUBLIC_MAPBOX_TOKEN`. Without a valid token, the app still renders with fallback behavior, but routing and address autocomplete will be limited.

## Roles

- **Customers** shop, order, ride, pay, and track everything in one account.
- **Merchants** publish products and manage their local businesses online.
- **Boda and car drivers** onboard, verify their identity and vehicle, accept work, navigate trips, and earn.
- **Operations teams** monitor users, merchants, riders, orders, disputes, verification, payouts, and platform analytics.

## Security and payments

- The server calculates totals, fees, distances, and ride fares; clients never set balances or final prices.
- Wallet top-ups are credited only after a valid confirmation or signed provider webhook.
- Checkout returns HTTP 402 when the wallet has insufficient funds.
- Customer data is scoped through Supabase Row Level Security.
- API writes resolve and authorize the authenticated actor server-side.
- The admin portal is protected by a secret path and signed session cookie.
- Currency is **UGX**.

### Production mobile money

```bash
MOMO_PROVIDER=flutterwave   # or another configured provider
FLUTTERWAVE_SECRET_KEY=     # server-only; never NEXT_PUBLIC_
```

The default provider is `demo`. Live payments must use a signed webhook integration configured in `src/lib/momo.ts` and the production environment.

## Technology

- **Web:** Next.js App Router, React, TypeScript, and Tailwind CSS
- **State:** Zustand for persisted carts, favorites, sessions, tracking, and preferences
- **Backend:** Supabase Postgres, Auth, Realtime, Storage, and Row Level Security
- **Maps:** Mapbox GL JS, Mapbox Directions, OSRM fallback, and live GPS markers
- **Hosting:** Vercel, with `godoor.site` as the production domain
- **Mobile:** Capacitor Android shell that wraps the live GoDoor web app

## Run locally

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>.

The recommended environment values are:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_MAPBOX_TOKEN=...
ADMIN_PATH_SECRET=...
```

Server-only secrets must never use the `NEXT_PUBLIC_` prefix.

### Useful commands

```bash
npm run dev    # start the development server
npm run build  # create a production build
npm start      # start the production server
```

## Android APK

The Android project wraps the live `https://godoor.site` experience so users receive web updates automatically while using the GoDoor app shell.

```bash
npx cap add android       # first time only
npx cap sync android
cd android
./gradlew assembleDebug
```

The debug APK is written to:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

For public distribution, build and sign a release APK/AAB with a private keystore, keep the keystore outside Git, and attach the signed artifact to a GitHub Release. The repository’s GitHub Actions workflow can also build a debug APK for testing.

## Brand

- Keep the existing **GoDoor** logo and visual identity unchanged.
- Orange represents speed, movement, and the platform’s delivery energy.
- **ZentechX** remains the company attribution where already shown in the product.
- Theme colors and branded surfaces are controlled centrally through the existing design tokens.

## Repository

- Source: <https://github.com/KayembaIbrahim/godoor-platform>
- Remix project: <https://omgithub.com/KayembaIbrahim/godoor-platform>

## Contributing

Run the production build before opening a pull request. Keep changes focused, preserve the existing GoDoor brand, do not commit credentials or access tokens, and document any new environment variable.
