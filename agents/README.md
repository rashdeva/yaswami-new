# Агенты (Hermes)

Роли и скиллы агентов «Я с вами». Как это устроено и зачем — `docs/agents-inbox.md`.

```
agents/
  Dockerfile        образ сервиса hermes: официальный Hermes + файлы ролей
  init.sh           при старте контейнера кладёт роль на том /opt/data
  operator/         роль: собеседник команды в Telegram
    SOUL.md         характер и правила
    config.yaml     модель, инструменты, подключение к нашему MCP
    skills/         скиллы роли (SKILL.md)
```

## Выкладка

Сервис `hermes` в проекте Railway `yaswami`, том на `/opt/data` (память, сессии, вход в модель).

```bash
railway up agents --path-as-root --service hermes
```

Роль меняется правкой файлов здесь и повторной выкладкой: при старте `init.sh` перезаписывает `SOUL.md`, `config.yaml` и `skills/yaswami` на томе. Остальное на томе (память, вход в Grok, расписания) сохраняется.

## Переменные сервиса

| Переменная | Что это |
|---|---|
| `YASWAMI_MCP_URL` | адрес MCP нашего API: `https://<сайт>/mcp` |
| `YASWAMI_MCP_TOKEN` | токен `ysw_…` пользователя из `ADMIN_IDS`: от его имени агент читает переписку и пишет людям |
| `TELEGRAM_BOT_TOKEN` | токен бота командного чата (отдельный от бота «Я с вами») |
| `TELEGRAM_ALLOWED_USERS` | Telegram id тех, с кем бот разговаривает, через запятую |
| `API_SERVER_ENABLED`, `API_SERVER_KEY` | HTTP-вход Hermes внутри контейнера — для проверок и будущих ролей; ключ не короче 16 символов, иначе вход молча не включается |

## Вход в модель

Один раз, по подписке Grok (хранится на томе):

```bash
railway ssh --service hermes -- hermes auth add xai-oauth --no-browser
```

Команда печатает адрес и код; код подтверждается в браузере под аккаунтом с подпиской.
