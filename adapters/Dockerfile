FROM node:22.23.2-bookworm-slim
WORKDIR /adapter
COPY object-store.mjs ./
RUN mkdir -p /data && chown node:node /data
USER node
HEALTHCHECK --interval=10s --timeout=3s CMD node -e "fetch('http://127.0.0.1:9000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","object-store.mjs"]
