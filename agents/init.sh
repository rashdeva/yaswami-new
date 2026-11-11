#!/command/with-contenv sh
# Старт контейнера Hermes: роль и скиллы из репозитория кладём на том поверх прежних.
# Выполняется до запуска gateway (cont-init.d), от root; файлы отдаём пользователю hermes.
set -eu
SRC=/opt/yaswami-agents/operator
DATA="${HERMES_HOME:-/opt/data}"

: "${YASWAMI_MCP_URL:?адрес MCP нашего API, например https://<сайт>/mcp}"
: "${YASWAMI_MCP_TOKEN:?токен ysw_… пользователя из ADMIN_IDS}"

mkdir -p "$DATA/skills"
cp "$SRC/SOUL.md" "$DATA/SOUL.md"
rm -rf "$DATA/skills/yaswami"
cp -R "$SRC/skills" "$DATA/skills/yaswami"
# В конфиге токен: файл читает только hermes.
umask 077
sed -e "s|__MCP_URL__|$YASWAMI_MCP_URL|" -e "s|__MCP_TOKEN__|$YASWAMI_MCP_TOKEN|" "$SRC/config.yaml" > "$DATA/config.yaml"
chown -R hermes:hermes "$DATA/SOUL.md" "$DATA/skills/yaswami" "$DATA/config.yaml"
echo "[yaswami] роль operator обновлена из образа"
