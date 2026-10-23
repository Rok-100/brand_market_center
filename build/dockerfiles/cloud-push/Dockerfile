FROM python:3.12.15-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS runtime-base
RUN rm -f /etc/apt/sources.list.d/debian.sources && printf '%s\n' 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261007T000000Z/ bookworm main' 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261007T000000Z/ bookworm-security main' > /etc/apt/sources.list && apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY requirements/aux-python.lock.txt /opt/requirements.lock.txt
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /opt/requirements.lock.txt
FROM runtime-base AS dependencies
COPY app/ /work/
WORKDIR /work
FROM runtime-base AS runtime
COPY --from=dependencies --chown=10001:10001 /work /work
COPY --chown=10001:10001 storage/ /opt/pinying-storage/
WORKDIR /work
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/opt/pinying-storage
RUN mkdir -p /data /app/data /app/.wrangler /tmp/home && chown 10001:10001 /data /app/data /app/.wrangler /tmp/home
ENV HOME=/tmp/home
USER 10001:10001
CMD ["python", "-m", "app.video_push_notifications"]
