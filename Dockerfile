FROM node:22-bookworm-slim AS builder

WORKDIR /repo

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build:release

WORKDIR /repo/packages/sdk
RUN mkdir -p /app-dist/sdk && npm pack --pack-destination /app-dist/sdk

WORKDIR /repo/dist
RUN mkdir -p /app-dist/app && npm pack --pack-destination /app-dist/app


FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    FREYA_HOME=/data \
    FREYA_LAUNCH=/app

RUN mkdir -p /data

COPY --from=builder /app-dist/sdk/*.tgz /tmp/sdk.tgz
COPY --from=builder /app-dist/app/*.tgz /tmp/freya.tgz
RUN npm install -g /tmp/sdk.tgz --no-audit --no-fund && \
    npm install -g /tmp/freya.tgz --no-audit --no-fund && \
    rm -f /tmp/sdk.tgz /tmp/freya.tgz

COPY docker/config/schema.json /app/config/schema.json

EXPOSE 3000

VOLUME ["/data"]

CMD ["freya", "--no-cli", "--foreground", "--port", "3000"]

