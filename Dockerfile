# Образ для Railway: сервис api (API, собранные мини-приложение и админка) и сервис collector.
# Что запускать, выбирает переменная ENTRY сервиса; по умолчанию — API.
# Сборки TypeScript для бэка нет: Node запускает .ts напрямую.
FROM node:24-slim AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY apps/collector/package.json apps/collector/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/extract/package.json packages/extract/

# Мини-приложение: Vite собирает статику
FROM base AS web
RUN pnpm install --frozen-lockfile --filter "@yaswami/web..."
COPY packages/core packages/core
COPY apps/web apps/web
RUN pnpm --filter @yaswami/web build

# Админка: отдельное приложение на shadcn/ui, сервер отдаёт её по /admin
FROM base AS admin
RUN pnpm install --frozen-lockfile --filter "@yaswami/admin..."
COPY packages/core packages/core
COPY apps/admin apps/admin
RUN pnpm --filter @yaswami/admin build

FROM base
RUN pnpm install --frozen-lockfile --prod --filter "@yaswami/api..." --filter "@yaswami/collector..."
COPY apps/api apps/api
COPY apps/collector apps/collector
COPY packages/core packages/core
COPY packages/extract packages/extract
COPY --from=web /app/apps/web/dist apps/web/dist
COPY --from=admin /app/apps/admin/dist apps/admin/dist

ENV NODE_ENV=production
USER node
# Сначала миграции, потом сервер: при ошибке миграции контейнер не стартует, и Railway оставляет прошлую версию.
CMD ["sh", "-c", "node apps/api/src/migrate.ts && exec node ${ENTRY:-apps/api/src/main.ts}"]
