# Dockerfile - Final version for Bun on Render
FROM oven/bun:1-alpine

# Install system dependencies
RUN apk add --no-cache \
    postgresql-client \
    curl \
    bash

WORKDIR /app

# Copy package files first for better caching
COPY package.json ./

# Install dependencies
RUN bun install

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p logs dist

# Build the application with better error handling
RUN echo "🔨 Building application..." && \
    bun run build || (echo "❌ Build failed, checking for TypeScript errors..." && bun run dev --smoke)

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