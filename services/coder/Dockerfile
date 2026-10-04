FROM node:24-alpine AS sandbox
RUN apk add --no-cache python3
WORKDIR /runner
COPY shared/code-job.mjs services/coder/runner.mjs ./
USER 1000:1000
ENTRYPOINT ["node","/runner/runner.mjs"]

FROM node:24-alpine AS controller
RUN apk add --no-cache docker-cli
WORKDIR /app
COPY shared/code-job.mjs services/coder/server.mjs ./
ENV PORT=8092
CMD ["node","server.mjs"]
