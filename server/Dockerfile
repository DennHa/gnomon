# Build context is the repository root (the server bundles ../src, the Mac app's API logic):
#   docker build -f server/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY src /app/src
# The web app (/app) shows the Mac app's version and changelog.
COPY package.json CHANGELOG.md /app/
COPY server /app/server
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production GNOMON_DATA_DIR=/data PORT=8080 HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/package.json ./
RUN printf '#!/bin/sh\nexec node /app/dist/admin.mjs "$@"\n' > /usr/local/bin/gnomon-admin \
  && chmod 755 /usr/local/bin/gnomon-admin \
  && mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
