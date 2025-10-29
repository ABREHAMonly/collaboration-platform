# Dockerfile - Fixed with correct Bun image
FROM oven/bun:1-alpine AS base

# Install PostgreSQL client AND curl for health checks
RUN apk add --no-cache postgresql-client curl

WORKDIR /app

# Install dependencies
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# Copy node_modules from temp directory
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# Build application
RUN bun run build

# Production stage
FROM base AS release
COPY --from=prerelease /app/dist ./dist
COPY --from=prerelease /app/node_modules ./node_modules
COPY --from=prerelease /app/package.json ./
COPY --from=prerelease /app/scripts ./scripts
COPY --from=prerelease /app/logs ./logs

# Create non-root user for security
RUN addgroup -g 1001 -S bunjs
RUN adduser -S bunjs -u 1001
RUN chown -R bunjs:bunjs /app
USER bunjs

EXPOSE 4000

# Health check (using curl that we installed)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

CMD ["bun", "run", "start"]