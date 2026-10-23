FROM node:24-bookworm-slim
WORKDIR /learning-source/training
COPY services/learning/app/training/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY services/learning/app/ /learning-source/
COPY local/learning-main.mjs /integration/server.mjs
RUN mkdir -p /data /hub-dist && chown -R 10001:10001 /data
USER 10001:10001
CMD ["node","/integration/server.mjs"]
