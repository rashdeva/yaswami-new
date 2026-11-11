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
