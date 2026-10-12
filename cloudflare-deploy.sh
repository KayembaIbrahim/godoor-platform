#!/bin/bash
set -euo pipefail

# Cloudflare Pages deployment script for GoDoor platform
# Run this AFTER DNS swap to Cloudflare
# Prerequisites: wrangler CLI installed (`npm i -g wrangler`) and authenticated

echo "🚀 Deploying GoDoor to Cloudflare Pages..."

# 1. Ensure Cloudflare adapter is available (only needed for first run)
if ! npm ls @cloudflare/next-on-pages &>/dev/null; then
    echo "Installing @cloudflare/next-on-pages..."
    npm i -D @cloudflare/next-on-pages@1
fi

# 2. Build for Next.js
echo "Building Next.js app..."
npm run build

# 3. Convert to Cloudflare Pages format
echo "Converting to Cloudflare Pages format..."
npx @cloudflare/next-on-pages@1

# 4. Deploy to Pages (preview)
echo "Deploying to Cloudflare Pages (preview)..."
npx wrangler pages deploy .vercel/output/static \
  --project-name=godoor-platform \
  --branch=preview

# 5. After verifying preview works, promote to production:
# npx wrangler pages deployment promote <deployment-id> --project-name=godoor-platform
#
# Or deploy directly with custom domain:
# npx wrangler pages deploy .vercel/output/static \
#   --project-name=godoor-platform \
#   --branch=main \
#   --commit-matched

echo "✅ Build complete. Verify preview URL, then promote to production."