# ─── Stage 1: base — production deps only ────────────────────────────────────
FROM node:20-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ─── Stage 2: build — full deps + compile ────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Build client (Vite), server (tsc), and CLI (tsc)
RUN npm run build

# ─── Stage 3: production — lean final image ──────────────────────────────────
FROM node:20-slim AS production
WORKDIR /app

# Copy production node_modules from base
COPY --from=base /app/node_modules ./node_modules

# Copy compiled server + CLI
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/cli    ./dist/cli

# Copy compiled client (served as static files by Express)
COPY --from=build /app/dist/client ./dist/client

# Copy package.json for bin resolution
COPY package.json ./

EXPOSE 3001

CMD ["node", "dist/server/server/index.js"]
