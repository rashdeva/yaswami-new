# Сервис Hermes на Railway: официальный образ + наши роли и скиллы (docs/agents-inbox.md).
# Выкладка: railway up agents --path-as-root --service hermes
# ponytail: тег stable плавает; закрепить версию, когда обновление что-нибудь сломает.
FROM nousresearch/hermes-agent:stable
COPY operator /opt/yaswami-agents/operator
COPY support /opt/yaswami-agents/support
COPY hunter /opt/yaswami-agents/hunter
COPY host /opt/yaswami-agents/host
COPY illustrator /opt/yaswami-agents/illustrator
COPY --chmod=0755 init.sh /etc/cont-init.d/01-yaswami-agents
CMD ["gateway", "run"]
