# Сервис Hermes на Railway: официальный образ + наши роли и скиллы (docs/agents-inbox.md).
# Выкладка: railway up agents --path-as-root --service hermes
# Образ закреплён по дайджесту (stable на 2026-11-12): плавающий тег подменил бы роли, у которых токены сервиса.
# Обновить: docker buildx imagetools inspect nousresearch/hermes-agent:stable → новый Digest сюда.
FROM nousresearch/hermes-agent:stable@sha256:276d44685c65c0cb2a25f190b63c65c8906f9dc76486fb1c05ae71b5826bda08
COPY operator /opt/yaswami-agents/operator
COPY support /opt/yaswami-agents/support
COPY hunter /opt/yaswami-agents/hunter
COPY host /opt/yaswami-agents/host
COPY illustrator /opt/yaswami-agents/illustrator
COPY --chmod=0755 init.sh /etc/cont-init.d/01-yaswami-agents
CMD ["gateway", "run"]
