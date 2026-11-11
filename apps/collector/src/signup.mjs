// Куда уходит пользователь по кнопке «Записаться»: личка организатора с готовым сообщением,
// иначе ссылка на регистрацию, иначе сама публикация.
export function signupUrl(event, announcement, template) {
  const text = encodeURIComponent(template.replace('{title}', event.title));
  const username = event.telegram_username?.replace(/^@/, '');
  if (username && /^\w{4,32}$/.test(username)) return `https://t.me/${username}?text=${text}`;
  const phone = event.whatsapp_phone?.replace(/\D/g, '');
  if (phone) return `https://wa.me/${phone}?text=${text}`;
  if (/^https?:\/\//.test(event.url ?? '')) return event.url;
  return announcement.url;
}
