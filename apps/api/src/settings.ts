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
};
