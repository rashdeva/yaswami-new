// Настройки сервера из окружения. Отдельным объектом, чтобы тесты могли подменить значение.
const { PORT = '3000', RAILWAY_PUBLIC_DOMAIN } = process.env;

export const settings = {
  /** Адрес сайта без косой черты в конце: ссылки в разметке, в сообщении организатору, возврат после входа. */
  publicUrl: (process.env.PUBLIC_URL ?? (RAILWAY_PUBLIC_DOMAIN ? `https://${RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${PORT}`)).replace(/\/$/, ''),
  /** Город витрины и его часовой пояс; пока он один. */
  city: process.env.CITY ?? 'Дананг',
  timezone: process.env.TIMEZONE ?? 'Asia/Ho_Chi_Minh',
  /** Сколько событий организатор создаёт бесплатно; дальше — по подписке (её пока нет). */
  freeEventsLimit: Number(process.env.FREE_EVENTS_LIMIT ?? 10),
  /** Сколько ждать перед уведомлением о записи: за это время гость может передумать, а записи — собраться в сводку. */
  notifyDelayMs: Number(process.env.NOTIFY_DELAY_MS ?? 20_000),
  /** Сколько анонсов в минуту один человек может прислать боту на разбор: ИИ ограничен по запросам. */
  /** Роль поддержки в Hermes (support.ts): адрес её HTTP-входа без косой черты в конце и ключ. Пусто — бот отвечает сам. */
  supportUrl: (process.env.SUPPORT_URL ?? '').replace(/\/$/, ''),
  supportKey: process.env.SUPPORT_KEY ?? '',
  /** Telegram id тех, кому открыта админка переписки (/admin), через запятую. */
  adminIds: (process.env.ADMIN_IDS ?? '').split(',').map(Number).filter(Boolean),
  botMessagesPerMinute: Number(process.env.BOT_MESSAGES_PER_MINUTE ?? 5),
};
