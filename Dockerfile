# Образ для Railway: API и собранное мини-приложение в одном сервисе.
# Сборки TypeScript для бэка нет: Node запускает .ts напрямую.
FROM node:24-slim AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/

# Мини-приложение: Vite собирает статику
FROM base AS web
RUN pnpm install --frozen-lockfile --filter "@yaswami/web..."
COPY packages/core packages/core
COPY apps/web apps/web
RUN pnpm --filter @yaswami/web build

FROM base
RUN pnpm install --frozen-lockfile --prod --filter "@yaswami/api..."
COPY apps/api apps/api
COPY packages/core packages/core
COPY --from=web /app/apps/web/dist apps/web/dist

ENV NODE_ENV=production
USER node
# Сначала миграции, потом сервер: при ошибке миграции контейнер не стартует, и Railway оставляет прошлую версию.
CMD ["sh", "-c", "node apps/api/src/migrate.ts && exec node apps/api/src/main.ts"]
