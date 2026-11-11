# collector

Ходит юзерботом по Telegram-каналам и группам (Source), каждую новую публикацию (Announcement) пропускает через предфильтр, отдаёт Gemini и, если это анонс события, записывает его в таблицу `collected_events`.

```bash
cp apps/collector/.env.example apps/collector/.env   # CHANNELS, GEMINI_API_KEY, TG_API_ID, TG_API_HASH
pnpm install
pnpm db:up && pnpm db:migrate                        # локальный Postgres с таблицами
pnpm --filter @yaswami/collector login               # разовый вход юзербота, см. ниже
pnpm --filter @yaswami/collector start
pnpm --filter @yaswami/collector test
```

## Юзербот

Все источники из `CHANNELS` читаются через MTProto (ADR-0001). Нужен отдельный, не личный аккаунт: его могут заблокировать.

1. На my.telegram.org → API development tools создай приложение, впиши `TG_API_ID` и `TG_API_HASH` в `.env`.
2. `pnpm --filter @yaswami/collector login` — введи телефон, код и облачный пароль; `TG_SESSION` запишется в `.env`.

Публичные каналы и группы читаются без вступления и задаются по username. Закрытый канал задаётся числовым id: вступи в него этим аккаунтом (не больше нескольких вступлений в сутки), выполни `pnpm --filter @yaswami/collector chats` и впиши id вида `-100…` в `CHANNELS`. У события из закрытого канала без контакта в тексте ссылка записи ведёт на публикацию, которую видят только участники.

Одну сессию нельзя использовать в двух местах сразу: пока сборщик работает на Railway, локально с тем же `TG_SESSION` его не запускать.

## Данные

Таблицы описаны в `apps/api/src/db/schema.ts` и создаются миграциями API; сборщик только пишет в них (`src/store.mjs`).

`collected_events` — одно событие на строку, ключ `external_id` (`telegram:<канал>/<публикация>#<номер события в публикации>`):

- `event` (jsonb) — то, что извлёк ИИ: `title`, `description`, `starts_at` и `ends_at` (ISO 8601 с offset), `place`, `address`, `price`, `tags`, `telegram_username`, `whatsapp_phone`, `url`.
- `announcement` (jsonb) — публикация первого анонса: `id`, `url`, `published_at`, `author_username`, `text`.
- `starts_at`, `ends_at`, `telegram_username` — те же значения колонками, для выборок.
- `signup_url` — куда ведёт кнопка «Записаться»: личка организатора в Telegram с готовым сообщением (`SIGNUP_MESSAGE`), иначе WhatsApp, иначе ссылка на регистрацию, иначе сама публикация.

`telegram_username` — ключ, по которому вошедшему через Telegram организатору можно предложить подтвердить свои события.

Повторный анонс того же события (`src/dedupe.mjs`) не создаёт вторую строку, а дополняет первую и обновляет `updated_at`.

`collector_cursors` — номер последней разобранной публикации по каждому источнику.

Наружу события отдаёт API: `GET /collected-events` — предстоящие события по дате, без входа (`listCollectedEvents` в `apps/api/src/services.ts`).

## Railway

Сервис `collector` в проекте `yaswami` собирается из общего `Dockerfile`; переменная `ENTRY=apps/collector/src/main.mjs` выбирает, что запускать. Остальные переменные — как в `.env.example`, `DATABASE_URL` ссылается на адрес БД сервиса `api`. Деплой: `railway up --service collector`.

## Ограничения

- Склейка дублей — эвристика: тот же день и время плюс тот же контакт или похожее название.
- Публикации старше `MAX_AGE_DAYS` в ИИ не отправляются.
- Предфильтр (`src/prefilter.mjs`) пропускает к ИИ только публикации с признаком даты или времени. Анонс без них («скоро открытие, ждём всех») он отсеет.
- Бесплатный уровень Gemini: Google использует запросы для улучшения своих продуктов, лимиты запросов видны в AI Studio.
- Ссылки, спрятанные под текстом, и картинки из публикаций не забираются (`image_url` всегда `null`).
- Афиши не распознаются: событие, описанное только на картинке, будет пропущено.
