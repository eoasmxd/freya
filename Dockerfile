FROM node:22-bookworm-slim

ARG FREYA_VERSION=latest

WORKDIR /app

ENV NODE_ENV=production \
    FREYA_HOME=/data \
    FREYA_LAUNCH=/app

RUN mkdir -p /data

RUN npm install -g @eoasmxd/freya@${FREYA_VERSION} --no-audit --no-fund

COPY docker/config/schema.json /app/config/schema.json

EXPOSE 3000

VOLUME ["/data"]

CMD ["freya", "--no-cli", "--foreground", "--port", "3000"]

