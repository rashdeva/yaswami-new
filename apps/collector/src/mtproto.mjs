// Каналы и группы читаются юзерботом (MTProto, ADR-0001).
// Аккаунт — расходник: только чтение истории, никаких вступлений и отправок.
import telegram from 'telegram';
import sessions from 'telegram/sessions/index.js';
import { pickThumb } from './host.mjs';

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

const COVER_SIDE = 800; // обложку показываем на всю шапку события: превью 320 для неё мало
const COVER_MAX_BYTES = 400_000;

/** Фото публикации как обложка события: готовое превью Telegram (JPEG) или null — фото нет либо не скачалось. */
export async function downloadCover(client, msg) {
  const thumb = msg.media?.className === 'MessageMediaPhoto' && pickThumb(msg.media.photo?.sizes, COVER_SIDE);
  if (!thumb) return null;
  const data = await client.downloadMedia(msg, { thumb }).catch(() => null);
  const isJpeg = Buffer.isBuffer(data) && data[0] === 0xff && data[1] === 0xd8;
  return isJpeg && data.length <= COVER_MAX_BYTES ? data : null;
}

/** Публикации `numbers` одного источника: Map номер → сообщение. Удалённые публикации пропущены. */
export async function fetchPosts(client, chat, numbers) {
  if (!client.connected) await client.connect();
  if (isPrivate(chat)) client.dialogsLoaded ??= client.getDialogs({});
  await client.dialogsLoaded;
  const messages = await client.getMessages(isPrivate(chat) ? Number(chat) : chat, { ids: numbers });
  return new Map(messages.filter(Boolean).map((m) => [m.id, m]));
}

/** Сообщения публикации `id` (<канал>/<номер>) с её альбомом; null — публикации больше нет. */
export async function fetchAlbum(client, id) {
  const [, chat, n] = /^(.+)\/(\d+)$/.exec(id);
  const number = Number(n);
  // В альбоме не больше десяти сообщений подряд: соседи по обе стороны покрывают его целиком.
  const around = await fetchPosts(client, chat, Array.from({ length: 19 }, (_, i) => number - 9 + i).filter((x) => x > 0));
  const msg = around.get(number);
  if (!msg) return null;
  return msg.groupedId ? [...around.values()].filter((m) => String(m.groupedId) === String(msg.groupedId)).sort((a, b) => a.id - b.id) : [msg];
}

// ponytail: username → (id, access_hash) кэшируется только в памяти процесса. При POLL_MINUTES=0 (cron)
// resolveUsername дёргается на каждый запуск, а это самый флудоопасный вызов — тогда кэш надо класть в state.
/**
 * Новые публикации источника. У каждой — `album`: сообщения с её фото и видео. В альбоме текст несёт одно сообщение,
 * остальные — только медиа с тем же groupedId. ponytail: альбом, разрезанный границей пачки из 100, теряет часть медиа.
 */
export async function fetchChatAnnouncements(client, chat, afterNumber) {
  if (!client.connected) await client.connect();
  // По числовому id Telegram отдаёт только чаты, уже известные клиенту: один раз загружаем список диалогов.
  if (isPrivate(chat)) client.dialogsLoaded ??= client.getDialogs({});
  await client.dialogsLoaded;
  const messages = await client.getMessages(isPrivate(chat) ? Number(chat) : chat, { limit: 100, minId: afterNumber });
  return messages.flatMap((m) => toAnnouncement(chat, m).map((announcement) => ({
    announcement,
    album: m.groupedId ? messages.filter((o) => String(o.groupedId) === String(m.groupedId)).sort((a, b) => a.id - b.id) : [m],
  })));
}

const MEDIA_PHOTOS = 10; // в альбоме Telegram не больше десяти
const VIDEO_MAX_BYTES = 50_000_000; // ролик анонса — обычно 5–30 МБ; длинные записи эфиров не тащим

const isVideo = (m) => m.media?.className === 'MessageMediaDocument' && m.media.document?.mimeType?.startsWith('video/');

/** Фото публикации (превью 800 px, JPEG) — для ИИ и для страницы события. Не скачалось — пропускаем. */
export async function downloadPhotos(client, album) {
  const photos = [];
  for (const m of album.slice(0, MEDIA_PHOTOS)) {
    const data = await downloadCover(client, m);
    if (data) photos.push({ number: m.id, data });
  }
  return photos;
}

/** Видео публикации целиком, если не тяжелее VIDEO_MAX_BYTES. */
export async function downloadVideos(client, album) {
  const videos = [];
  for (const m of album.filter(isVideo)) {
    const { size, mimeType } = m.media.document;
    if (Number(size) > VIDEO_MAX_BYTES) continue;
    const data = await client.downloadMedia(m, {}).catch(() => null);
    if (Buffer.isBuffer(data)) videos.push({ number: m.id, data, type: mimeType });
  }
  return videos;
}
