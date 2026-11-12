# Админка (`apps/admin`)

Страница команды на `/admin`: переписка, агенты, организаторы, модерация собранных событий, наши аккаунты Telegram. Что она делает и зачем — `docs/agents-inbox.md`.

React 19 + Vite, отдельное приложение (`@yaswami/admin`) на том же домене. Адреса — TanStack Router (`basepath: '/admin'`), данные с сервера — TanStack Query; другого менеджера состояния нет. Оформление — shadcn/ui на Tailwind v4. Правило то же, что во фронте: **компонент рисует, хук знает, функция считает.**

**shadcn/ui и Tailwind живут только в `apps/admin`; мини-приложение и сайт (`apps/web`) их не используют: там свои компоненты и `tokens.css`.**

## Где что лежит

```
src/
  api.ts            единственное место, где есть fetch: только админские методы; типы — из @yaswami/core
  main.tsx          вход: QueryClient, тема по prefers-color-scheme, тосты
  router.tsx        все маршруты кодом и страницы: страница берёт адрес и раздаёт экрану props
  App.tsx           корневой layout: вход и «нет доступа», боковое меню, шапка
  hooks/            useXxx.ts: useQuery/useMutation поверх api.*; клавиши переписки
  hooks/keys.ts     все ключи запросов
  hooks/useAct.ts   действие админа: тост при ошибке, после — перечитать данные
  screens/          раздел = композиция: данные из хуков, разметка из components/; про адреса не знает
  components/       свои составные части, нужные двум экранам: Thread, Reply, Draft
  components/ui/    компоненты shadcn — ставит CLI, руками не правятся
  lib/              чистые функции без React, CSS и import.meta.env: выборки ленты, фильтр, поиск, подписи
  index.css         тема shadcn (переменные, светлая и тёмная) и свои анимации
```

Маршруты: `/admin` — «Люди» (`?c=<диалог>&agent=<роль>`), `/admin/feed`, `/admin/hosts`, `/admin/agents`, `/admin/events`, `/admin/accounts`.

## Правила

- **Запросы — только в хуках.** `api.*` видят только файлы в `hooks/`. Загрузка — `useQuery` с ключом из `hooks/keys.ts`, изменение — `useAct(…)`: он показывает ошибку тостом и перечитывает все запросы (данных в админке немного).
- **Опрос — `refetchInterval`**, а не таймеры: лента и открытая переписка — раз в 4 с, события — раз в 30 с.
- **Вход** — cookie сайта (`/api/auth/telegram/login`), в разработке — `Bearer VITE_DEV_TOKEN` (токен админа из `pnpm api:token`). Telegram initData здесь нет. Экраны рисуются только после загрузки ленты: до неё `App.tsx` показывает вход, «нет доступа» или ожидание.
- **Типы запросов и ответов — из `@yaswami/core`**, по сети — `Wire<T>`. Новая операция админки — строка в `api.ts` с тем же именем, что у сервиса, и хук в `hooks/`.
- **Текст ошибки для человека** — в `MESSAGES` в `api.ts`, по коду ошибки бэка.
- **Чистая функция — в `lib/`, с тестом рядом** (`*.test.ts`, `node:test`). Файлы `lib/` запускает Node напрямую: импорты относительные, с расширением `.ts`, без алиаса `@/`.
- **Разметка — из компонентов shadcn** и классов Tailwind; цвета — только переменные темы (`bg-muted`, `text-muted-foreground`, `border`…). Своего CSS нет, кроме анимаций в `index.css`.
- **Адрес — в `router.tsx`.** Экран получает выбранное и обработчики через props; ссылку из раздела в раздел (организатор → его диалог) делает страница.
- **Переписка — компоненты чата shadcn**: `message-scroller`, `message`, `bubble` (`components/Thread.tsx`).
- **Клавиши** — `hooks/useInboxKeys.ts`; поле находят по `data-reply`, `data-draft`, `data-search`, выбранную строку — по `data-selected`.

## Компонент shadcn

```
cd apps/admin
pnpm dlx shadcn@latest search @shadcn -q <слово>   # есть ли такой
pnpm dlx shadcn@latest add <имя>                    # кладёт в src/components/ui, ставит зависимости
```

Настройки — `components.json` (стиль `radix-nova`, нейтральная палитра, иконки lucide, алиас `@/*`). Файл в `components/ui/` не правится: нужен другой вид — `className` снаружи или своя обёртка в `components/`. Компонент, который перестал использоваться, удаляется.

## Запуск и проверка

`pnpm dev` (API на 3000) и `pnpm dev:admin` — админка на `http://localhost:5174/admin/`, запросы `/api` уходят на локальный API; превью `admin` в `.claude/launch.json`. Сборка — `pnpm build:admin`: сервер отдаёт `apps/admin/dist` по `/admin` (`apps/api/src/main.ts`), в образ её кладёт стадия `admin` в `Dockerfile`.

`pnpm typecheck`, `pnpm test`; затем открыть раздел в превью и пройти сценарий руками.
