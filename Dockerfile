FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY frontend ./frontend
COPY scripts ./scripts
COPY tailwind.config.cjs ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/dist
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tini libreoffice-writer fonts-thai-tlwg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY package.json ./
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/server.mjs"]

