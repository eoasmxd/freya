FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    FREYA_HOME=/data \
    FREYA_APP=/app \
    FREYA_LAUNCH=/app

RUN mkdir -p /data

COPY --from=builder /app/dist /app

RUN npm install --omit=dev --no-audit --no-fund

EXPOSE 3000

VOLUME ["/data"]

CMD ["node", "core/dist/index.js", "--no-cli"]
