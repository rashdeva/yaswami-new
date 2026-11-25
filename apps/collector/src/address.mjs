// Адрес чата Telegram строкой: так его хранят источники, LEAD_CHATS и reply_to в очереди отправки.

/**
 * username или числовой id в виде, который понимает gramjs: у канала и супергруппы (`Channel`) — `-100…`,
 * у обычной группы (`Chat`) — `-…`. Обычной группе `-100…` не подходит: такой id указывает на другой чат.
 */
export const chatAddress = (chat) => chat.username ?? (chat.className === 'Channel' ? `-100${chat.id}` : `-${chat.id}`);

/**
 * Ссылка на сообщение по адресу чата. У канала и супергруппы без username — t.me/c/… (открывается участникам);
 * у обычной группы ссылок на сообщения нет — пустая строка.
 */
export function messageUrl(chat, id) {
  if (!/^-?\d+$/.test(chat)) return `https://t.me/${chat}/${id}`;
  return chat.startsWith('-100') ? `https://t.me/c/${chat.slice(4)}/${id}` : '';
}
