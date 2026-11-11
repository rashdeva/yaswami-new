# Образ API для Railway. Сборки TypeScript нет: Node запускает .ts напрямую.
FROM node:24-slim
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --prod

COPY apps/api apps/api
COPY packages/core packages/core

ENV NODE_ENV=production
USER node
# Сначала миграции, потом сервер: при ошибке миграции контейнер не стартует, и Railway оставляет прошлую версию.
CMD ["sh", "-c", "node apps/api/src/migrate.ts && exec node apps/api/src/main.ts"]
