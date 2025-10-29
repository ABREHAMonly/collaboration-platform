#!/bin/bash
# render-build.sh - Build script for Render.com

echo "🔧 Starting build process..."

# Check if we're in production
if [ "$RENDER" = "true" ]; then
    echo "🏗️  Production build detected"
    
    # Install dependencies
    bun install
    
    # Build the application
    bun run build
    
    # Verify build
    if [ -f "dist/server.js" ]; then
        echo "✅ Build successful"
    else
        echo "❌ Build failed - dist/server.js not found"
        exit 1
    fi
else
    echo "🔨 Development environment"
    bun install
fi

echo "🎉 Build process completed"