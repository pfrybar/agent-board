# Build the web UI. The server has no build step: Node runs its
# TypeScript directly.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime: production dependencies, the server source, and the built UI.
FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DB_PATH=/data/agent-board.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=build /app/web/dist ./web/dist

# The SQLite database lives on this volume. Create it owned by the
# unprivileged user so a fresh named volume starts out writable.
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/index.ts"]
