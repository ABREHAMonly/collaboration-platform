# Dockerfile - Fixed with dependency cleanup
FROM oven/bun:1-alpine

# Install system dependencies
RUN apk add --no-cache \
    postgresql-client \
    curl \
    bash

WORKDIR /app

# Copy package files first for better caching
COPY package.json ./

# Clean any problematic dependencies and install
RUN bun remove "@apollo/server/express4" 2>/dev/null || true && \
    bun install

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p logs dist

# Set production environment
ENV NODE_ENV=production

# Build the application
RUN bun run build

# Verify build output
RUN if [ -f "dist/server.js" ]; then \
        echo "✅ Build successful - dist/server.js exists"; \
    else \
        echo "❌ Build failed - dist/server.js not found"; \
        echo "📁 Current directory contents:"; \
        ls -la; \
        echo "📁 dist directory contents:"; \
        ls -la dist/ 2>/dev/null || echo "dist directory does not exist"; \
        exit 1; \
    fi

# Create non-root user for security
RUN addgroup -g 1001 -S bunjs && \
    adduser -S bunjs -u 1001 && \
    chown -R bunjs:bunjs /app

USER bunjs

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

# Start the application
CMD ["bun", "run", "start"]