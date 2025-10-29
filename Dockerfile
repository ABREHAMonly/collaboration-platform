# Dockerfile - Enhanced for Bun on Render
FROM oven/bun:1-alpine

# Install system dependencies
RUN apk add --no-cache \
    postgresql-client \
    curl \
    bash

WORKDIR /app

# Copy package files first for better caching
COPY package.json ./

# Install dependencies (create bun.lockb if missing)
RUN if [ -f "bun.lockb" ]; then bun install --frozen-lockfile; else bun install; fi

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p logs dist

# Build the application
RUN bun run build

# Verify build output
RUN ls -la dist/ || echo "Build might have failed"

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