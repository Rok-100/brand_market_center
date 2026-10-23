FROM nginx:1.28.3-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236
COPY app/ /etc/nginx/
USER 101:101
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
