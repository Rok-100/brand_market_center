FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS node-runtime
FROM python:3.12.15-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS runtime-base
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
RUN rm -f /etc/apt/sources.list.d/debian.sources && printf '%s\n' 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261007T000000Z/ bookworm main' 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261007T000000Z/ bookworm-security main' > /etc/apt/sources.list && apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY requirements/daily-brief.lock.txt /opt/requirements.lock.txt
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /opt/requirements.lock.txt
FROM runtime-base AS dependencies
COPY app/ /app/
WORKDIR /app
COPY dashboard/ /opt/report-dashboard/
WORKDIR /opt/report-dashboard
RUN npm ci --ignore-scripts --no-audit --no-fund --omit=dev
WORKDIR /app
FROM runtime-base AS runtime
COPY --from=dependencies --chown=10001:10001 /app /app
COPY --chown=10001:10001 storage/ /opt/pinying-storage/
WORKDIR /app
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/opt/pinying-storage
RUN mkdir -p /data /app/data /app/.wrangler /tmp/home && chown 10001:10001 /data /app/data /app/.wrangler /tmp/home
ENV HOME=/tmp/home
COPY --from=dependencies /opt/report-dashboard/ /opt/report-dashboard/
ENV REPORT_QUERY_MODE=direct REPORT_DASHBOARD_DIR=/opt/report-dashboard/dist/server/modules/dashboard REPORT_KEYWORD_MODE=bot
ENV REPORT_FONT=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc REPORT_FONT_BOLD=/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc
USER 10001:10001
CMD ["python", "run_daily.py", "--serve"]
