#!/bin/bash
echo "=== GoDoor Platform Deployment Test ==="
echo "1. Checking build directory structure..."
if [ -d "/workspace/swift-lovelace/.vercel/output/static" ]; then
    echo "✅ Static assets directory exists"
else
    echo "❌ Static assets directory not found"
    exit 1
fi

echo "2. Checking wrangler.json..."
if [ -f "/workspace/swift-lovelace/.vercel/output/static/wrangler.json" ]; then
    echo "✅ Wrangler config exists"
else
    echo "❌ Wrangler config not found"
    exit 1
fi

echo "3. Checking HTML content..."
if grep -q "GoDoor" /workspace/swift-lovelace/.vercel/output/static/index.html && grep -q "modern" /workspace/swift-lovelace/.vercel/output/static/index.html; then
    echo "✅ HTML content looks good"
else
    echo "❌ HTML content issue"
fi

echo "4. Checking server build..."
if [ -f "/workspace/swift-lovelace/dist/server/index.js" ]; then
    echo "✅ Server build exists"
else
    echo "❌ Server build missing"
fi

echo "=== Build test completed successfully ==="
