# Luma API — локальная копия

Образец для наших имён и форм. Файлы лежат как скачаны, руками не правятся. Как ими пользоваться — `docs/agents/api.md`.

Скачано 2026-11-12:

| Файл | Откуда |
|---|---|
| `openapi.json` (OpenAPI 3.1, 74 операции) | https://public-api.luma.com/openapi.json |
| `llms.txt` (оглавление документации) | https://docs.luma.com/llms.txt |
| `api-conventions.md`, `formats.md`, `rate-limits.md`, `getting-started-with-your-api.md`, `changelog.md`, `examples.md` | `https://docs.luma.com/reference/<имя файла>` |

Обновить:

```bash
curl -fsS https://public-api.luma.com/openapi.json -o docs/reference/luma/openapi.json
```

Найти аналог: `jq -r '.paths | keys[]' docs/reference/luma/openapi.json` — список операций; `jq '.paths["/v1/events/create"]' …` — поля одной.

У Luma есть и MCP-сервер (`https://mcp.luma.com`, вход через OAuth). Списка его инструментов здесь нет: без входа он его не отдаёт.
