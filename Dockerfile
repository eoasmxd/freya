FROM node:22-bookworm-slim AS builder

WORKDIR /repo

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build:release

WORKDIR /repo/dist
RUN npm pack --pack-destination /app-dist


# 阶段 2：轻量生产运行时
FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    FREYA_HOME=/data \
    FREYA_LAUNCH=/app

RUN mkdir -p /data

COPY --from=builder /app-dist/*.tgz /tmp/freya.tgz
RUN npm install -g /tmp/freya.tgz --no-audit --no-fund && rm -f /tmp/freya.tgz

COPY docker/config/schema.json /app/config/schema.json

EXPOSE 3000

VOLUME ["/data"]

CMD ["freya", "--no-cli", "--foreground", "--port", "3000"]

