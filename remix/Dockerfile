FROM node:22.23.2-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk tesseract-ocr tesseract-ocr-chi-sim && rm -rf /var/lib/apt/lists/*
WORKDIR /app/render-worker
COPY render-worker/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY render-worker/ ./
COPY shared/ /app/shared/
COPY local-support.mjs /app/local-support.mjs
COPY local-workbench.js /app/render-worker/client-dist/local-workbench.js
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server.mjs"]
