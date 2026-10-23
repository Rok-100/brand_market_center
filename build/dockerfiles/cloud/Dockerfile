FROM python:3.12.15-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS runtime-base
RUN rm -f /etc/apt/sources.list.d/debian.sources && printf '%s\n' 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261007T000000Z/ bookworm main' 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261007T000000Z/ bookworm-security main' > /etc/apt/sources.list && apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
COPY build/requirements/cloud.lock.txt /opt/requirements.lock.txt
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /opt/requirements.lock.txt
ARG PLAYWRIGHT_CHROMIUM=false
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN if [ "$PLAYWRIGHT_CHROMIUM" = true ]; then python -m playwright install --with-deps chromium && chmod -R a+rX /opt/playwright; fi
FROM runtime-base AS dependencies
COPY services/cloud/app/ /app/
WORKDIR /app/backend
FROM runtime-base AS runtime
COPY --from=dependencies --chown=10001:10001 /app /app
COPY --chown=10001:10001 local/empty/ /opt/pinying-storage/
WORKDIR /app/backend
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/opt/pinying-storage
RUN mkdir -p /data /app/data /app/.wrangler /tmp/home && chown 10001:10001 /data /app/data /app/.wrangler /tmp/home
ENV HOME=/tmp/home
RUN find /app -type f -name "*.sh" -exec sed -i "s/\r$//" {} +
USER 10001:10001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000"]
