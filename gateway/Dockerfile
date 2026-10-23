FROM node:22.23.2-bookworm-slim
WORKDIR /gateway
COPY hub/ ./hub/
COPY server.mjs local-shell.js ./
USER node
EXPOSE 8080
CMD ["node","server.mjs"]
