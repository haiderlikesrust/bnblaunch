# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS web-build
COPY . .
RUN npm run build:dokploy

FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production SHEN_RUNTIME=node HOST=0.0.0.0 PORT=3000
COPY --from=web-build --chown=node:node /app/dist/standalone/ ./
COPY --chown=node:node drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["node","server.js"]

FROM node:24-bookworm-slim AS signer
WORKDIR /app
COPY services/signer/package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node services/signer/*.mjs ./services/signer/
COPY --chown=node:node shared ./shared
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production PORT=8080 SIGNER_DB_PATH=/data/signer.sqlite
EXPOSE 8080
CMD ["node","services/signer/index.mjs"]

FROM node:24-bookworm-slim AS worker
WORKDIR /app
COPY --chown=node:node services/worker/index.mjs ./index.mjs
USER node
ENV NODE_ENV=production PORT=8081
CMD ["node","index.mjs"]

FROM nginx:1.28-alpine AS gateway
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
