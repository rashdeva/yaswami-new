// Профиль организатора: что он сам пишет о себе в Telegram и в своём канале, и сводка ИИ по этому тексту.
import telegram from 'telegram';

/**
 * Канал из текста «о себе»: первая ссылка t.me/… или @…, кроме самого контакта, ботов, почты и приглашений.
 * ponytail: @name в «о себе» может оказаться ником в Instagram, а в Telegram под ним — чужой канал.
 * Если такие сводки появятся — брать только личный канал профиля и ссылки t.me/.
 */
export function channelFromBio(bio, username) {
  for (const [, name] of (bio ?? '').matchAll(/(?:t\.me\/|@)(\w{4,32})\b(?!\.\w)/gi)) {
    if (name.toLowerCase() !== username && !/^joinchat$|bot$/i.test(name)) return name;
  }
  return null;
}

/**
 * Telegram-контакт события из источника `channel`. Сам канал — не контакт: ИИ иногда подставляет его, когда в посте
 * контакта нет. В канале организатора (`host` — его username) пишут «пишите в личку» без ника: тогда контакт — он сам.
 * Если организатор и есть этот канал (площадка), подставлять нечего: записаться в канал нельзя.
 */
export function contactFor(event, channel, host) {
  const isChannel = (u) => u.replace(/^@/, '').toLowerCase() === channel.toLowerCase();
  if (event.telegram_username && !isChannel(event.telegram_username)) return event.telegram_username;
  return !event.whatsapp_phone && host && !isChannel(host) ? host : null;
}

// FLOOD_WAIT пробрасываем — повторим на следующем проходе. Остальное (нет такого username, это канал, а не человек)
// считаем ответом «не человек».
const orNull = (e) => { if (e.seconds) throw e; return null; };

async function fetchChannel(client, username) {
  const entity = await client.getEntity(username);
  if (entity.className !== 'Channel' || !entity.broadcast) return null; // группа или человек — не канал
  const { fullChat } = await client.invoke(new telegram.Api.channels.GetFullChannel({ channel: entity }));
  const posts = await client.getMessages(entity, { limit: 30 });
  return {
    id: String(entity.id), username: entity.username.toLowerCase(), title: entity.title, about: fullChat.about,
    posts: posts.map((m) => m.message?.slice(0, 1000)).filter(Boolean),
  };
}

export const HOST_PHOTOS = 6; // сколько последних фото канала храним у организатора; столько же показывает API
const PHOTO_SIDE = 320; // длинная сторона превью. У Telegram готовые размеры — 320 (m), 800 (x), 1280 (y)
const PHOTO_MAX_BYTES = 200_000;

/**
 * Какое готовое превью Telegram скачать: самое маленькое с длинной стороной от PHOTO_SIDE, иначе самое большое.
 * Сами картинки не сжимаем — Telegram уже хранит уменьшенные JPEG, поэтому библиотека для сжатия не нужна (ADR-0003).
 */
export function pickThumb(sizes, side = PHOTO_SIDE) {
  const sized = (sizes ?? []).filter((s) => s.w && s.h).sort((a, b) => Math.max(a.w, a.h) - Math.max(b.w, b.h));
  return (sized.find((s) => Math.max(s.w, s.h) >= side) ?? sized.at(-1))?.type ?? null;
}

/**
 * Фото сообщества: картинки из последних 30 публикаций канала, не больше HOST_PHOTOS.
 * `known` — источники уже сохранённых фото: их не качаем заново.
 * { sources — что сейчас в канале, новые сверху; added — скачанные превью, старые сверху } или null, если канал недоступен.
 */
export async function fetchChannelPhotos(client, channel, known = []) {
  if (!client.connected) await client.connect();
  const posts = await client.getMessages(channel, { limit: 30 }).catch(orNull);
  if (!posts) return null;
  // Только фото самой публикации: картинка из предпросмотра ссылки — не фото сообщества.
  const shots = posts
    .filter((m) => m.media?.className === 'MessageMediaPhoto' && pickThumb(m.media.photo?.sizes))
    .slice(0, HOST_PHOTOS)
    .map((m) => ({ source: `telegram:${channel}/${m.id}`, m }));
  const added = [];
  for (const { source, m } of shots.filter((s) => !known.includes(s.source)).reverse()) {
    const data = await client.downloadMedia(m, { thumb: pickThumb(m.media.photo.sizes) }).catch(orNull);
    const isJpeg = Buffer.isBuffer(data) && data[0] === 0xff && data[1] === 0xd8;
    if (isJpeg && data.length <= PHOTO_MAX_BYTES) added.push({ source, data });
  }
  return { sources: shots.map((s) => s.source), added };
}

/** { telegram_id, name, bio, channel: { username, title, about, posts } | null } или null, если под username не человек и не канал. */
export async function fetchProfile(client, username) {
  if (!client.connected) await client.connect();
  const full = await client.invoke(new telegram.Api.users.GetFullUser({ id: username })).catch(orNull);
  const user = full?.users[0];
  if (user?.bot) return null;
  if (!user) {
    // Контактом указан канал площадки: организатор — сама площадка, профиль пишем по её каналу.
    const channel = await fetchChannel(client, username).catch(orNull);
    // У каналов и людей в Telegram разные нумерации: каналу даём id вида -100…, чтобы он не совпал с человеком.
    return channel && { telegram_id: Number(`-100${channel.id}`), name: channel.title, bio: channel.about || null, channel };
  }
  const bio = full.fullUser.about ?? null;
  // Личный канал, закреплённый в профиле, надёжнее ссылки из текста.
  const personal = full.chats.find((c) => String(c.id) === String(full.fullUser.personalChannelId))?.username;
  const channelName = personal ?? channelFromBio(bio, username);
  return {
    telegram_id: Number(user.id), // по нему профиль привяжется к пользователю, когда человек войдёт в Ясвами
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || username,
    bio,
    channel: channelName ? await fetchChannel(client, channelName).catch(orNull) : null,
  };
}
