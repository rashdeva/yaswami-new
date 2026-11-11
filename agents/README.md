# Агенты (Hermes)

Роли и скиллы агентов «Я с вами». Как это устроено и зачем — `docs/agents-inbox.md`.

```
agents/
  Dockerfile        образ сервиса hermes: официальный Hermes + файлы ролей
  init.sh           при старте контейнера кладёт роль на том /opt/data
  operator/         роль: собеседник команды в Telegram (профиль Hermes по умолчанию)
    SOUL.md         характер и правила
    config.yaml     модель, инструменты, подключение к нашему MCP
    skills/         скиллы роли (SKILL.md)
  support/          роль: отвечает людям, которые пишут боту «Я с вами» (профиль support)
  hunter/           роль: пишет черновики ответов на вопросы «куда сходить» в чатах (профиль hunter)
  illustrator/      роль: рисует короткий ролик-историю о событии через Grok Imagine (профиль illustrator)
```

## Выкладка

Сервис `hermes` в проекте Railway `yaswami`, том на `/opt/data` (память, сессии, вход в модель).

```bash
railway up agents --path-as-root --service hermes
```

Роль меняется правкой файлов здесь и повторной выкладкой: при старте `init.sh` перезаписывает `SOUL.md`, `config.yaml` и `skills/yaswami` каждого профиля на томе.

Один процесс Hermes обслуживает оба профиля на порту 8642: `operator` — по `/v1`, `support` — по `/p/support/v1`, у каждого свой ключ. Наш API ходит к `support` по внутренней сети Railway (`http://hermes.railway.internal:8642/p/support`); сеть эта только IPv6, поэтому `API_SERVER_HOST=::`. Остальное на томе (память, вход в Grok, расписания) сохраняется.

## Переменные сервиса

| Переменная | Что это |
|---|---|
| `YASWAMI_MCP_URL` | адрес MCP нашего API: `https://<сайт>/mcp` |
| `YASWAMI_MCP_TOKEN` | токен `ysw_…` пользователя из `ADMIN_IDS`: от его имени агент читает переписку и пишет людям |
| `TELEGRAM_BOT_TOKEN` | токен бота командного чата (отдельный от бота «Я с вами») |
| `TELEGRAM_ALLOWED_USERS` | Telegram id тех, с кем бот разговаривает, через запятую |
| `API_SERVER_ENABLED`, `API_SERVER_HOST`, `API_SERVER_KEY` | HTTP-вход Hermes: `true`, `::` и ключ роли `operator`; ключ не короче 16 символов, иначе вход молча не включается |
| `SUPPORT_API_KEY` | ключ роли `support`; тот же ключ — в `SUPPORT_KEY` сервиса `api` |
| `HUNTER_API_KEY` | ключ роли `hunter`; тот же ключ — в `HUNTER_KEY` сервиса `api` |
| `ILLUSTRATOR_API_KEY` | ключ роли `illustrator`; тот же ключ — в `ILLUSTRATOR_KEY` сервиса `api`. Не задан — роль не ставится |

## Вход в модель

Один раз на каждый профиль, по подписке Grok (хранится на томе):

```bash
railway ssh --service hermes -- hermes auth add xai-oauth --no-browser
```

```bash
railway ssh --service hermes -- hermes -p support auth add xai-oauth --no-browser
```

Команда печатает адрес и код; код подтверждается в браузере под аккаунтом с подпиской.

## Ролики (illustrator)

Ролики получают все предстоящие события каталога: API раз в 15 минут заказывает ролик ближайшему событию, у которого его ещё нет (`startVideoLoop` в `apps/api/src/services.ts`), пока не кончится дневной лимит. Вне очереди ролик может заказать оператор инструментом `event_video_request` — по просьбе команды в чате. Наш API передаёт роли данные события и фото анонса (`apps/api/src/services.ts`, `requestCollectedVideo`), роль придумывает историю из пяти планов и одним вызовом `video_generate` снимает вертикальный ролик на 10 секунд, в ответ отдаёт ссылку. Ролик лежит в хранилище xAI; в событии хранится только ссылка, страница события играет его в шапке и сама пишет поверх название и время.

Каждая генерация стоит 1–2 доллара, поэтому: один ролик на событие (неудачная попытка тоже считается — заново не заказываем) и не больше `ILLUSTRATOR_DAILY_LIMIT` (по умолчанию 3) заказов в сутки на стороне API.

Чтобы включить: задать `ILLUSTRATOR_API_KEY` сервису `hermes`, `ILLUSTRATOR_URL` (`http://hermes.railway.internal:8642/p/illustrator`) и `ILLUSTRATOR_KEY` сервису `api`, войти в модель:

```bash
railway ssh --service hermes -- hermes -p illustrator auth add xai-oauth --no-browser
```
