// Настройки сервера из окружения. Отдельным объектом, чтобы тесты могли подменить значение.
import { DEFAULT_CITY_ID } from '@yaswami/core';

const { PORT = '3000', RAILWAY_PUBLIC_DOMAIN } = process.env;

export const settings = {
  /**
   * Город по умолчанию: его получает всё, чему город не указан (и колонки city_id в базе — migrate.ts), его витрина на
   * главной. У копии для другой страны свой, например tashkent; город должен быть в таблице cities.
   */
  defaultCityId: process.env.DEFAULT_CITY_ID || DEFAULT_CITY_ID,
  /** Адрес сайта без косой черты в конце: ссылки в разметке, в сообщении организатору, возврат после входа. */
  publicUrl: (process.env.PUBLIC_URL ?? (RAILWAY_PUBLIC_DOMAIN ? `https://${RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`)).replace(/\/$/, ''),
  /** Токен командного бота Hermes (тот же, что TELEGRAM_BOT_TOKEN сервиса hermes): через него идут оповещения «ждёт человека». Пусто — их шлёт бот «Я с вами». */
  teamBotToken: process.env.TEAM_BOT_TOKEN ?? '',
  /** Возможности, открытые всем без личного включения (имена из Feature в core), через запятую. */
  featuresOn: (process.env.FEATURES_ON ?? '').split(',').map((f) => f.trim()).filter(Boolean),
  /** Сколько событий организатор создаёт бесплатно; дальше — по подписке (её пока нет). */
  freeEventsLimit: Number(process.env.FREE_EVENTS_LIMIT ?? 10),
  /** Сколько ждать перед уведомлением о записи: за это время гость может передумать, а записи — собраться в сводку. */
  notifyDelayMs: Number(process.env.NOTIFY_DELAY_MS ?? 20_000),
  /** Сколько по событию не должно быть новых отзывов, чтобы организатору ушла сводка. */
  feedbackSettleMs: Number(process.env.FEEDBACK_SETTLE_MS ?? 10 * 60_000),
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
   * `illustratorDailyLimit` — сколько роликов можно заказать за сутки: каждый стоит 1–2 доллара. Обложек не касается.
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
  /** Роль curator в Hermes: раз в день собирает витрину города из полок (curator.ts, ADR-0009). Пусто — выключено. */
  curatorUrl: (process.env.CURATOR_URL ?? '').replace(/\/$/, ''),
  curatorKey: process.env.CURATOR_KEY ?? '',
  /** Роль librarian в Hermes: раз в день разбирает темы и раскладку событий (librarian.ts, ADR-0010). Пусто — выключено. */
  librarianUrl: (process.env.LIBRARIAN_URL ?? '').replace(/\/$/, ''),
  librarianKey: process.env.LIBRARIAN_KEY ?? '',
  /** Час по времени первого города, когда хранитель разбирает темы: раньше куратора — витрина собирается по готовым темам. */
  librarianHour: Number(process.env.LIBRARIAN_HOUR ?? 6),
  /** Час по времени города, когда куратор собирает витрину на день. */
  curatorHour: Number(process.env.CURATOR_HOUR ?? 7),
  /** Общий со сборщиком секрет: им он подписывает сообщения с аккаунтов Telegram. Пусто — приём закрыт. */
  collectorSecret: process.env.COLLECTOR_SECRET ?? '',
  /** Bundle id приложения для iOS: им Apple подписывает id_token (поле aud) при входе через Apple. */
  appleBundleId: process.env.APPLE_BUNDLE_ID ?? 'app.yaswami',
  /**
   * OAuth-клиенты Google, которым приложение запрашивает id_token (поле aud) при входе через Google, через запятую.
   * Это Web client ID из Google Cloud Console: им приложение на Android подписывает запрос. Пусто — вход через Google закрыт.
   */
  googleClientIds: (process.env.GOOGLE_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /** Telegram id тех, кому открыта админка переписки (/admin), через запятую. */
  adminIds: (process.env.ADMIN_IDS ?? '').split(',').map(Number).filter(Boolean),
  /** Сколько сообщений в минуту один человек может прислать боту: каждый ответ роли поддержки — запрос к ИИ. */
  botMessagesPerMinute: Number(process.env.BOT_MESSAGES_PER_MINUTE ?? 5),
  /** Сколько сообщений в минуту бот вообще принимает от одного человека: сверх — не записываются и не обрабатываются. */
  botInboundPerMinute: Number(process.env.BOT_INBOUND_PER_MINUTE ?? 20),
  /** Сколько вложений в сутки от одного человека бот сохраняет в бакет и расшифровывает. */
  botMediaPerDay: Number(process.env.BOT_MEDIA_PER_DAY ?? 30),
  /** Сколько запросов к API в минуту с одного адреса, до входа; сверх — 429. Щедро: за адресом оператора много людей. */
  ipRequestsPerMinute: Number(process.env.IP_REQUESTS_PER_MINUTE ?? 600),
  /** Сколько дорогих запросов (поиск, вход) в минуту с одного адреса. */
  ipCostlyPerMinute: Number(process.env.IP_COSTLY_PER_MINUTE ?? 60),
  /** Сколько запросов к API в минуту делает один вошедший человек или токен; сверх — 429. */
  requestsPerMinute: Number(process.env.REQUESTS_PER_MINUTE ?? 300),
  /** Ключ шифрования сборщика (тот же ACCOUNTS_KEY): им API шифрует код и пароль входа в наш аккаунт Telegram. Пусто — шаг входа отклоняется (accounts_key_missing): открытым текстом секреты в базу не кладём. */
  accountsKey: process.env.ACCOUNTS_KEY ?? '',
  /** Ключ Groq: расшифровка голосовых и видео в переписке (media.ts). Пусто — вложения сохраняются без расшифровки. */
  groqKey: process.env.GROQ_API_KEY ?? '',
  transcribeModel: process.env.TRANSCRIBE_MODEL ?? 'whisper-large-v3-turbo',
};
