// Настройки сервера из окружения. Отдельным объектом, чтобы тесты могли подменить значение.
const { PORT = '3000', RAILWAY_PUBLIC_DOMAIN } = process.env;

export const settings = {
  /** Адрес сайта без косой черты в конце: ссылки в разметке, в сообщении организатору, возврат после входа. */
  publicUrl: (process.env.PUBLIC_URL ?? (RAILWAY_PUBLIC_DOMAIN ? `https://${RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`)).replace(/\/$/, ''),
  /** Токен командного бота Hermes (тот же, что TELEGRAM_BOT_TOKEN сервиса hermes): через него идут оповещения «ждёт человека». Пусто — их шлёт бот «Я с вами». */
  teamBotToken: process.env.TEAM_BOT_TOKEN ?? '',
  /** Город витрины и его часовой пояс; пока он один. */
  city: process.env.CITY ?? 'Дананг',
  timezone: process.env.TIMEZONE ?? 'Asia/Ho_Chi_Minh',
  /** Возможности, открытые всем без личного включения (имена из Feature в core), через запятую. */
  featuresOn: (process.env.FEATURES_ON ?? '').split(',').map((f) => f.trim()).filter(Boolean),
  /** Сколько событий организатор создаёт бесплатно; дальше — по подписке (её пока нет). */
  freeEventsLimit: Number(process.env.FREE_EVENTS_LIMIT ?? 10),
  /** Сколько ждать перед уведомлением о записи: за это время гость может передумать, а записи — собраться в сводку. */
  notifyDelayMs: Number(process.env.NOTIFY_DELAY_MS ?? 20_000),
  /** Сколько по событию не должно быть новых отзывов, чтобы организатору ушла сводка. */
  feedbackSettleMs: Number(process.env.FEEDBACK_SETTLE_MS ?? 10 * 60_000),
  /** Сколько анонсов в минуту один человек может прислать боту на разбор: ИИ ограничен по запросам. */
  /** Роль поддержки в Hermes (support.ts): адрес её HTTP-входа без косой черты в конце и ключ. Пусто — бот отвечает сам. */
  supportUrl: (process.env.SUPPORT_URL ?? '').replace(/\/$/, ''),
  supportKey: process.env.SUPPORT_KEY ?? '',
  /** Кому роль поддержки отвечает: Telegram id через запятую. Пусто — всем. Пока роль проверяется, здесь только мы. */
  supportUserIds: (process.env.SUPPORT_USER_IDS ?? '').split(',').map(Number).filter(Boolean),
  /**
   * Роль hunter в Hermes: отвечает на вопросы «куда сходить» в чатах (inbox.ts, recordLead). Пусто — выключено.
   * `hunterUserIds` — пока роль проверяется: реагируем только на вопросы этих людей (Telegram id через запятую).
   */
  hunterUrl: (process.env.HUNTER_URL ?? '').replace(/\/$/, ''),
  hunterKey: process.env.HUNTER_KEY ?? '',
  hunterUserIds: (process.env.HUNTER_USER_IDS ?? '').split(',').map(Number).filter(Boolean),
  /**
   * Роль illustrator в Hermes: рисует ролик о событии (services.ts, requestCollectedVideo). Пусто — выключено.
   * `illustratorDailyLimit` — сколько роликов можно заказать за сутки: каждая генерация стоит 1–2 доллара.
   */
  illustratorUrl: (process.env.ILLUSTRATOR_URL ?? '').replace(/\/$/, ''),
  illustratorKey: process.env.ILLUSTRATOR_KEY ?? '',
  illustratorDailyLimit: Number(process.env.ILLUSTRATOR_DAILY_LIMIT ?? 3),
  /**
   * Роль host в Hermes: пишет организаторам, к которым через нас записались, и отвечает на их сообщения —
   * всегда черновиками (inbox.ts, recordHostLead). Пусто — выключено.
   */
  hostUrl: (process.env.HOST_URL ?? '').replace(/\/$/, ''),
  hostKey: process.env.HOST_KEY ?? '',
  /** Общий со сборщиком секрет: им он подписывает сообщения с аккаунтов Telegram. Пусто — приём закрыт. */
  collectorSecret: process.env.COLLECTOR_SECRET ?? '',
  /** Telegram id тех, кому открыта админка переписки (/admin), через запятую. */
  adminIds: (process.env.ADMIN_IDS ?? '').split(',').map(Number).filter(Boolean),
  botMessagesPerMinute: Number(process.env.BOT_MESSAGES_PER_MINUTE ?? 5),
  /** Сколько запросов к API в минуту делает один вошедший человек или токен; сверх — 429. */
  requestsPerMinute: Number(process.env.REQUESTS_PER_MINUTE ?? 300),
  /** Ключ шифрования сборщика (тот же ACCOUNTS_KEY): им API шифрует код и пароль входа в наш аккаунт Telegram. Пусто — они ждут сборщика открытыми. */
  accountsKey: process.env.ACCOUNTS_KEY ?? '',
};
