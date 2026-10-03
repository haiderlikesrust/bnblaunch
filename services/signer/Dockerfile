FROM node:24-bookworm-slim
WORKDIR /app
COPY services/signer/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node services/signer/*.mjs /app/services/signer/
COPY --chown=node:node shared /app/shared
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production PORT=8080 SIGNER_DB_PATH=/data/signer.sqlite
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","services/signer/index.mjs"]
