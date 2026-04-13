# ── Stage 1: Node.js Server ──────────────────────────────────────────────────
FROM node:20-slim AS node-base

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application code
COPY server.js config.js ./
COPY dbmodels/ ./dbmodels/
COPY middleware/ ./middleware/
COPY routes/ ./routes/
COPY views/ ./views/
COPY public/ ./public/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
