// Каналы и группы читаются юзерботом (MTProto, ADR-0001).
// Аккаунт — расходник: только чтение истории, никаких вступлений и отправок.
import telegram from 'telegram';
import sessions from 'telegram/sessions/index.js';

export function connect({ apiId, apiHash, session = '' }) {
  return new telegram.TelegramClient(new sessions.StringSession(session), Number(apiId), apiHash, {
    connectionRetries: 5,
    floodSleepThreshold: 120, // FLOOD_WAIT до двух минут пережидаем, дольше — ошибка и повтор на следующем проходе
  });
}

// Закрытый канал задаётся числовым id (-100…): username у него нет.
const isPrivate = (chat) => /^-?\d+$/.test(chat);

export function toAnnouncement(chat, msg) {
  if (!msg.message || msg.sender?.bot) return [];
  return [{
    id: `${chat}/${msg.id}`,
    number: msg.id,
    // У закрытого канала ссылка вида t.me/c/… открывается только у его участников.
    url: isPrivate(chat) ? `https://t.me/c/${chat.replace(/^-100/, '')}/${msg.id}` : `https://t.me/${chat}/${msg.id}`,
    published_at: new Date(msg.date * 1000).toISOString(),
    image_url: null,
    // Автор — только человек: у публикации канала отправитель сам канал, ему в личку не написать.
    author_username: msg.sender?.className === 'User' ? msg.sender.username ?? null : null,
    // ponytail: ссылки, спрятанные под текстом, теряются — msg.message это текст без разметки.
    text: msg.message,
  }];
}

/** Отклик на публикацию: просмотры (у публикаций в группах их нет) и сумма реакций. */
export const toStats = (msg) => ({
  views: msg.views ?? null,
  reactions: (msg.reactions?.results ?? []).reduce((n, r) => n + r.count, 0),
});

/** Отклик на публикации `numbers` одного источника: Map номер → { views, reactions }. Удалённые публикации пропущены. */
export async function fetchStats(client, chat, numbers) {
  if (!client.connected) await client.connect();
  if (isPrivate(chat)) client.dialogsLoaded ??= client.getDialogs({});
  await client.dialogsLoaded;
  const messages = await client.getMessages(isPrivate(chat) ? Number(chat) : chat, { ids: numbers });
  return new Map(messages.filter(Boolean).map((m) => [m.id, toStats(m)]));
}

// ponytail: username → (id, access_hash) кэшируется только в памяти процесса. При POLL_MINUTES=0 (cron)
// resolveUsername дёргается на каждый запуск, а это самый флудоопасный вызов — тогда кэш надо класть в state.
export async function fetchChatAnnouncements(client, chat, afterNumber) {
  if (!client.connected) await client.connect();
  // По числовому id Telegram отдаёт только чаты, уже известные клиенту: один раз загружаем список диалогов.
  if (isPrivate(chat)) client.dialogsLoaded ??= client.getDialogs({});
  await client.dialogsLoaded;
  const messages = await client.getMessages(isPrivate(chat) ? Number(chat) : chat, { limit: 100, minId: afterNumber });
  return messages.flatMap((m) => toAnnouncement(chat, m));
}
