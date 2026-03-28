FROM node:20-slim AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Build stage
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production
FROM node:20-slim
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist/client ./dist/client
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/server/index.js"]
