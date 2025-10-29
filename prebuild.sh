#!/bin/bash
# prebuild.sh - Clean dependencies before build

echo "🔧 Preparing build..."

# Remove any problematic dependencies
if [ -f "package.json" ]; then
    echo "📦 Cleaning package.json..."
    # Remove the invalid apollo dependency if it exists
    bun remove "@apollo/server/express4" 2>/dev/null || true
fi

echo "✅ Pre-build preparation complete"