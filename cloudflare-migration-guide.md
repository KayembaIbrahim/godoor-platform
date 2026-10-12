# Cloudflare Pages Migration Guide for GoDoor

## After DNS Swap (you do):
1. Go to Cloudflare dashboard → Domain → Nameservers → Copy nameservers
2. Update your domain registrar's nameservers to Cloudflare's
3. Wait 5-30 minutes for DNS propagation
4. SSH/console access: No changes needed — just wait for propagation

## Then I (the agent) will do — or you can run these steps:

### 1. Set environment variables in Cloudflare Pages dashboard

Go to **Pages → Your Project → Settings → Environment variables** and add:

| Variable | Value (from .env.local) |
|----------|------------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ikbdhfjqiptsecunxzti.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `REDACTED_JWT` |
| `SUPABASE_SERVICE_ROLE_KEY` | `REDACTED_JWT` |
| `SUPABASE_ACCESS_TOKEN` | `REDACTED_SUPABASE_ACCESS_TOKEN` |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `PLACEHOLDER` — set your actual Mapbox token if used |
| Any payment/webhook env vars from `.env.vercel-prod` | Set those too |

### 2. Secrets (via wrangler or dashboard)

Run locally:
```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_ACCESS_TOKEN
```

Then follow the prompts to paste the values from `.env.local`.

### 3. Deploy

Option A — via the shell script:
```bash
chmod +x cloudflare-deploy.sh
./cloudflare-deploy.sh
```

Option B — manual wrangler:
```bash
# 1. Install adapter
npm i -D @cloudflare/next-on-pages@1

# 2. Build + convert
npx @cloudflare/next-on-pages@1

# 3. Deploy preview
wrangler pages deploy .vercel/output/static \
  --project-name=godoor-platform \
  --branch=preview

# 4. When green, promote
wrangler pages deployment promote <deployment-id> --project-name=godoor-platform
```

### 3. Configure Custom Domain

Once the preview deployment is green:
1. In Cloudflare Pages → Domain → Add custom domain
2. Enter `godoor.site`
3. Enable "Force HTTPS"
4. Wait for SSL provisioning (a few minutes)

### 4. Verify

Visit `https://godoor.site` and check:
- Homepage loads
- `/app` works (customer home)
- `/business/store` shows weekday opening days
- `/business/bookings` shows booked orders list
- Map renders with markers
- Button bounce animation works

## Rollback

If anything breaks:
- In Cloudflare dashboard → Pages → Your deployment → "Rollback"
- Or repoint DNS back to Vercel's nameservers

## What Changes Were Already Committed

These are already in the git history (commit a043976):
- Store settings: weekday opening days UI
- New `/business/bookings` page
- Button elastic-press / bounce polish
- Theme fixes (white light, true black dark)
- Map marker bounce animation
- And all other UI/UX polish

The code is ready — only the Cloudflare infrastructure setup is needed after DNS.