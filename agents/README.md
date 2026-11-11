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

## Вход в модель

Один раз на каждый профиль, по подписке Grok (хранится на томе):

```bash
railway ssh --service hermes -- hermes auth add xai-oauth --no-browser
```

```bash
railway ssh --service hermes -- hermes -p support auth add xai-oauth --no-browser
```

Команда печатает адрес и код; код подтверждается в браузере под аккаунтом с подпиской.
