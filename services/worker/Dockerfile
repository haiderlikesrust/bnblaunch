FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node services/worker/index.mjs ./index.mjs
USER node
ENV NODE_ENV=production PORT=8081
EXPOSE 8081
HEALTHCHECK --interval=30s --start-period=240s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8081/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","index.mjs"]
