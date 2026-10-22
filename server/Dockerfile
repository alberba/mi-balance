FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4322 PWA_DIR=/app/pwa
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=dependencies /app/node_modules ./node_modules
COPY server/package.json server/package-lock.json ./
COPY server/auth.js server/metrics.js server/store.js ./
COPY server/app ./app
COPY server/scripts ./scripts
COPY server/entrypoint.sh ./entrypoint.sh
COPY pwa ./pwa
RUN chmod +x entrypoint.sh && mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 4322
ENTRYPOINT ["./entrypoint.sh"]
