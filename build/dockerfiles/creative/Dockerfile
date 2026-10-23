FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS runtime-base
RUN rm -f /etc/apt/sources.list.d/debian.sources && printf '%s\n' 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261007T000000Z/ bookworm main' 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261007T000000Z/ bookworm-security main' > /etc/apt/sources.list && apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY build/pnpm/ /opt/pnpm/
RUN cd /opt/pnpm && npm ci --ignore-scripts --no-audit --no-fund && ln -s /opt/pnpm/node_modules/pnpm/bin/pnpm.cjs /usr/local/bin/pnpm
FROM runtime-base AS dependencies
COPY services/creative/app/ /app/
WORKDIR /app
RUN npm ci --ignore-scripts --no-audit --no-fund
FROM runtime-base AS runtime
COPY --from=dependencies --chown=10001:10001 /app /app
COPY --chown=10001:10001 local/empty/ /opt/pinying-storage/
WORKDIR /app
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/opt/pinying-storage
RUN mkdir -p /data /app/data /app/.wrangler /tmp/home && chown 10001:10001 /data /app/data /app/.wrangler /tmp/home
ENV HOME=/tmp/home
RUN find /app -type f -name "*.sh" -exec sed -i "s/\r$//" {} +
USER 10001:10001
CMD ["node", "server/start-runtime.mjs"]
