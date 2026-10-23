FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS node-runtime
FROM python:3.12.15-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS runtime-base
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
RUN rm -f /etc/apt/sources.list.d/debian.sources && printf '%s\n' 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261007T000000Z/ bookworm main' 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261007T000000Z/ bookworm-security main' > /etc/apt/sources.list && apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 ffmpeg fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY build/requirements/onecreation.lock.txt /opt/requirements.lock.txt
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /opt/requirements.lock.txt
FROM runtime-base AS dependencies
COPY services/onecreation/app/ /opt/workbench/
WORKDIR /opt/workbench/app
RUN cd assets/material-center-runtime && npm ci --ignore-scripts --no-audit --no-fund --omit=dev
FROM runtime-base AS runtime
COPY --from=dependencies --chown=10001:10001 /opt/workbench /opt/workbench
COPY --chown=10001:10001 shared/runtime-adapters/onecreation/ /opt/pinying-storage/
WORKDIR /opt/workbench/app
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/opt/pinying-storage
RUN mkdir -p /data /app/data /app/.wrangler /tmp/home && chown 10001:10001 /data /app/data /app/.wrangler /tmp/home
ENV HOME=/tmp/home
ENV LIBTV_PATH=/usr/local/bin/libtv KLING_CLI_PATH=/usr/local/bin/kling LOCALAPPDATA=/data AI_MATERIAL_STORAGE_ROOT=/data/material-store
RUN find /opt/workbench -type f -name "*.sh" -exec sed -i "s/\r$//" {} +
USER 10001:10001
CMD ["node", "server.js"]
