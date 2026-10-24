# ==============================================================================
# AI StudyMate Backend - Production Multi-Stage Dockerfile
# Builds a lightweight, hardened container image running as non-root user.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build & Compilation
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies required for native modules and Prisma
RUN apk add --no-cache libc6-compat openssl

# Install npm dependencies using package-lock.json for reproducible builds
COPY package.json package-lock.json ./
RUN npm ci

# Copy Prisma schema and configuration files
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY prisma7.config.ts ./

# Generate Prisma Client
RUN npx prisma generate

# Copy source code and build TypeScript to /app/dist
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Hardened Production Runtime
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

# Install dumb-init for proper PID 1 signal forwarding and openssl for Prisma
RUN apk add --no-cache dumb-init openssl

# Set production environment flags
ENV NODE_ENV=production
ENV PORT=5000

# Create a non-root system group and user
RUN addgroup -g 10001 -S nodejs && \
    adduser -u 10001 -S nodejs -G nodejs

# Create uploads directory and assign ownership
RUN mkdir -p /app/uploads/documents && \
    chown -R nodejs:nodejs /app/uploads

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy compiled code, Prisma runtime artifacts and schema from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/prisma7.config.ts ./prisma7.config.ts
COPY --from=builder --chown=nodejs:nodejs /app/prisma.config.ts ./prisma.config.ts

# Switch to non-root user
USER nodejs

# Container port exposure
EXPOSE 5000

# Container liveness health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

# Forward OS signals (SIGTERM, SIGINT) cleanly to Node.js process for graceful shutdown
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
