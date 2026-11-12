#!/command/with-contenv sh
# Старт контейнера Hermes: роли и скиллы из репозитория кладём на том поверх прежних.
# Выполняется до запуска gateway (cont-init.d), от root; файлы отдаём пользователю hermes.
set -eu
SRC=/opt/yaswami-agents
DATA="${HERMES_HOME:-/opt/data}"

: "${YASWAMI_MCP_URL:?адрес MCP нашего API, например https://<сайт>/mcp}"
: "${YASWAMI_MCP_TOKEN:?токен ysw_… пользователя из ADMIN_IDS}"
: "${SUPPORT_API_KEY:?ключ HTTP-входа роли support, не короче 16 символов}"
: "${HUNTER_API_KEY:?ключ HTTP-входа роли hunter, не короче 16 символов}"

# Ролям, с которыми говорят посторонние, — свой токен с областью действия (pnpm api:token <id> <имя> support|catalog):
# сервер отдаёт такому токену только его инструменты. Не задан — роль работает на общем токене, как раньше.
[ -n "${YASWAMI_SUPPORT_MCP_TOKEN:-}" ] || echo "[yaswami] ВНИМАНИЕ: YASWAMI_SUPPORT_MCP_TOKEN не задан — роль support работает на токене админа"
[ -n "${YASWAMI_CATALOG_MCP_TOKEN:-}" ] || echo "[yaswami] ВНИМАНИЕ: YASWAMI_CATALOG_MCP_TOKEN не задан — роль hunter работает на токене админа"

# Кладёт роль $1 в домашнюю папку профиля $2: характер, скиллы и конфиг с адресом нашего MCP и токеном $3
# (без него — общий токен оператора).
install_role() {
  mkdir -p "$2/skills"
  cp "$SRC/$1/SOUL.md" "$2/SOUL.md"
  rm -rf "$2/skills/yaswami"
  [ -d "$SRC/$1/skills" ] && cp -R "$SRC/$1/skills" "$2/skills/yaswami"
  # В конфиге токен: файл читает только hermes.
  sed -e "s|__MCP_URL__|$YASWAMI_MCP_URL|" -e "s|__MCP_TOKEN__|${3:-$YASWAMI_MCP_TOKEN}|" "$SRC/$1/config.yaml" > "$2/config.yaml"
  chmod 600 "$2/config.yaml"
  chown -R hermes:hermes "$2/SOUL.md" "$2/skills" "$2/config.yaml"
  echo "[yaswami] роль $1 обновлена из образа"
}

# operator — профиль по умолчанию: командный чат в Telegram.
install_role operator "$DATA"

# Остальные роли — отдельные профили: с ними говорит только наш API. Один gateway обслуживает все профили
# на общем порту; роль доступна по адресу /p/<роль>/v1 со своим ключом.
#   support — отвечает людям, которые пишут боту; hunter — пишет черновики ответов на вопросы в чатах;
#   host — пишет черновики сообщений организаторам.
install_profile() {
  home="$DATA/profiles/$1"
  [ -d "$home" ] || s6-setuidgid hermes hermes profile create "$1"
  install_role "$1" "$home" "${3:-}"
  # Профиль читает ключи только из своего .env, переменные контейнера ему не видны: ключ запасной модели — тоже сюда.
  (umask 077; printf 'API_SERVER_ENABLED=true\nAPI_SERVER_KEY=%s\n' "$2" > "$home/.env"
   if [ -n "${GEMINI_API_KEY:-}" ]; then printf 'GEMINI_API_KEY=%s\n' "$GEMINI_API_KEY" >> "$home/.env"; fi)
  chown hermes:hermes "$home/.env"
}
install_profile support "$SUPPORT_API_KEY" "${YASWAMI_SUPPORT_MCP_TOKEN:-}"
install_profile hunter "$HUNTER_API_KEY" "${YASWAMI_CATALOG_MCP_TOKEN:-}"
# host — пишет организаторам. Как и illustrator, без ключа не ставится.
if [ -n "${HOST_API_KEY:-}" ]; then install_profile host "$HOST_API_KEY"; fi
# illustrator — рисует ролики о событиях. Ключ не задан — профиль не ставим: роль необязательная,
# из-за неё контейнер падать не должен.
if [ -n "${ILLUSTRATOR_API_KEY:-}" ]; then install_profile illustrator "$ILLUSTRATOR_API_KEY"; fi
