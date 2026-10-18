# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --workspace web --include-workspace-root=false --ignore-scripts
COPY shared shared
COPY web web
RUN npm run build --workspace web

FROM node:24-alpine
# PUID/PGID pick who owns /data and runs the server (Unraid uses 99:100).
ENV NODE_ENV=production \
    PUID=1000 \
    PGID=1000 \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist
WORKDIR /app
RUN apk add --no-cache su-exec tzdata
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --workspace server --include-workspace-root=false --omit=dev --ignore-scripts && npm cache clean --force
COPY shared shared
COPY server server
COPY --from=build /app/web/dist web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/src/index.ts"]
