import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { createExtractor, createOfferExtractor, createSummarizer, isSameEvent, looksLikeEvent, mergeEvents } from '@yaswami/extract';
import { signupUrl } from './signup.mjs';
import { connect, downloadCover, downloadPhotos, downloadVideos, fetchChatAnnouncements, fetchPosts, toStats } from './mtproto.mjs';
import { createBucket } from './bucket.mjs';
import { createStore } from './store.mjs';
import { contactFor, fetchChannelPhotos, fetchProfile } from './host.mjs';
import { backfillTopics } from './backfill.mjs';
import { createSender } from './sender.mjs';
import { fetchLeads } from './lead.mjs';
import { resolveAuthor, saveOffers } from './offers.mjs';

const env = process.env;
// Источники живут в таблице sources (раздел «Источники» в админке); CHANNELS при старте только дополняет её.
const channels = (env.CHANNELS ?? '').split(',').map((c) => c.trim().replace(/^@/, '')).filter(Boolean);
if (!env.TG_SESSION) throw new Error('TG_SESSION пуст: выполни pnpm --filter @yaswami/collector run login');
if (!env.DATABASE_URL) throw new Error('DATABASE_URL пуст');
const userbot = connect({ apiId: env.TG_API_ID, apiHash: env.TG_API_HASH, session: env.TG_SESSION });
const store = createStore(env.DATABASE_URL);
const bucket = createBucket();
if (!bucket) console.log('Фото и видео анонсов не сохраняются: нужны S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY и MEDIA_PUBLIC_URL');
const llmPauseMs = Number(env.LLM_PAUSE_MS ?? 4500); // ≈13 запросов в минуту при лимите 15
const maxAgeMs = Number(env.MAX_AGE_DAYS ?? 14) * 86_400_000; // старые публикации в ИИ не отправляем
const pollMinutes = Number(env.POLL_MINUTES ?? 15);
const signupMessage = env.SIGNUP_MESSAGE ?? 'Привет! Я нашёл событие «{title}» на Ясвами, хочу записаться.';
const extract = createExtractor({
  model: env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite',
  city: env.CITY ?? 'Дананг',
  timezone: env.TIMEZONE ?? 'Asia/Ho_Chi_Minh',
});

const summarize = createSummarizer({ model: env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite' });
const extractOffer = createOfferExtractor({ model: env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite' });
// Поиск по username — самый флудоопасный вызов Telegram: за проход собираем немного профилей, остальные — в следующий.
const PROFILES_PER_PASS = 15;
// Username, под которыми не человек (канал, бот, никого). ponytail: помним только в памяти процесса —
// после перезапуска проверим ещё раз; при POLL_MINUTES=0 (cron) это надо класть в базу.
const notPeople = new Set();

async function profileHosts() {
  // Сначала те, кого команда добавила по username в админке: их ждут.
  const requested = await store.requestedHosts();
  const usernames = [...new Set([...requested, ...(await store.unprofiled()).filter((u) => !notPeople.has(u))])].slice(0, PROFILES_PER_PASS);
  for (const username of usernames) {
    const profile = await fetchProfile(userbot, username);
    if (profile) {
      const { telegram_id, name, bio, channel } = profile;
      await store.saveHost({ telegram_id, username, name, bio, channel: channel?.username ?? null, summary: await summarize(profile) });
    } else if (requested.includes(username)) await store.rejectRequestedHost(username);
    else notPeople.add(username);
    console.log(`@${username}: ${profile ? `профиль${profile.channel ? `, канал @${profile.channel.username}` : ''}` : 'не человек и не канал'}`);
    await sleep(llmPauseMs);
  }
}

// Фото сообщества обновляем раз в неделю; за проход — несколько каналов: поиск канала по username тоже флудоопасен.
const PHOTOS_REFRESH_DAYS = Number(env.PHOTOS_REFRESH_DAYS ?? 7);
const PHOTO_HOSTS_PER_PASS = 5;

async function refreshPhotos() {
  for (const host of await store.stalePhotos(PHOTOS_REFRESH_DAYS, PHOTO_HOSTS_PER_PASS)) {
    const latest = await fetchChannelPhotos(userbot, host.channel, await store.photoSources(host.id));
    if (latest) await store.savePhotos(host.id, latest.sources, latest.added);
    await store.photosChecked(host.id); // и когда канал недоступен: иначе спрашивали бы его каждый проход
    console.log(`@${host.channel}: ${latest ? `фото ${latest.sources.length}, новых ${latest.added.length}` : 'канал недоступен'}`);
    await sleep(2000);
  }
}

// Публикации предстоящих событий смотрим каждый проход, один запрос на источник. Отклик: в момент сбора публикации
// минуты от роду, просмотры и реакции набегают потом. Обложка: фото анонса, если его ещё не сохранили.
// ponytail: события без фото помним в памяти процесса — после перезапуска посмотрим ещё раз.
const noCover = new Set();

async function refreshPosts() {
  const byChat = new Map();
  for (const { external_id, has_cover } of await store.upcoming()) {
    const [, chat, number] = /^telegram:(.+)\/(\d+)#/.exec(external_id) ?? [];
    if (!chat) continue;
    const posts = byChat.get(chat) ?? byChat.set(chat, new Map()).get(chat);
    (posts.get(Number(number)) ?? posts.set(Number(number), []).get(Number(number))).push({ external_id, has_cover });
  }
  for (const [chat, posts] of byChat) {
    // Источник недоступен (событие прислали боту из чужого канала) — пропускаем, остальные обновляем.
    const messages = await fetchPosts(userbot, chat, [...posts.keys()]).catch((e) => console.error(`публикации ${chat}: ${e.message}`));
    for (const [number, msg] of messages ?? []) {
      await store.setStats(`telegram:${chat}/${number}#`, toStats(msg));
      const bare = posts.get(number).filter((e) => !e.has_cover && !noCover.has(e.external_id));
      const cover = bare.length ? await downloadCover(userbot, msg) : null;
      for (const { external_id } of bare) {
        if (cover) await store.saveCover(external_id, `telegram:${chat}/${number}`, cover);
        else noCover.add(external_id);
      }
    }
    await sleep(2000);
  }
}

// Сообщение в API от имени сборщика: личное сообщение на аккаунте, «печатает» или вопрос из чата.
const toApi = async (path, body) => {
  const res = await fetch(`${env.API_URL}/internal/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-collector-secret': env.COLLECTOR_SECRET },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`API ответил ${res.status}`);
};

// Большие чаты, где ищем вопросы «куда сходить» (lead.mjs): username без @ через запятую. Анонсы из них не берём.
const leadChats = (env.LEAD_CHATS ?? '').split(',').map((c) => c.trim().replace(/^@/, '')).filter(Boolean);

async function pollLeads(chat) {
  const key = `lead:${chat}`; // отметка в той же таблице, что у каналов с анонсами
  const { last, read, leads, offers } = await fetchLeads(userbot, chat, cursors[key] ?? 0);
  for (const lead of leads) await toApi('lead', lead);
  if (last !== cursors[key]) await store.saveCursor(key, (cursors[key] = last));
  const masters = await saveOffers({ store, extractOffer, resolve: (u) => resolveAuthor(userbot, u), pause: () => sleep(llmPauseMs) }, offers);
  // Каждый проход — в журнал: иначе не отличить «вопросов нет» от «чат не читается».
  console.log(`вопросы ${chat}: прочитано ${read}, похоже на «куда сходить» — ${leads.length}, мастеров ${masters} из ${offers.length}`);
}

// Railway проверяет /health при деплое (общий railway.json) и гасит старый контейнер, только когда новый ответил.
if (env.PORT) createServer((_, res) => res.end('ok')).listen(env.PORT);
// Пока старый контейнер жив, к Telegram не подключаемся: одну сессию нельзя использовать в двух местах сразу —
// Telegram отзывает её навсегда (AUTH_KEY_DUPLICATED), и аккаунт приходится подключать заново. Так уже было.
const startupDelayMs = Number(env.STARTUP_DELAY_MS ?? (env.RAILWAY_ENVIRONMENT ? 45_000 : 0));
if (startupDelayMs) {
  console.log(`Ждём ${startupDelayMs / 1000} с, пока остановится прежний контейнер`);
  await sleep(startupDelayMs);
}

// Аккаунты, которые пишут людям: вход по шагам из админки, приём и отправка личных сообщений (sender.mjs).
// Работает рядом со сбором, раз в несколько секунд; без ключа и адреса API выключено.
if (env.ACCOUNTS_KEY && env.API_URL && env.COLLECTOR_SECRET) {
  const sender = createSender({
    store, apiId: env.TG_API_ID, apiHash: env.TG_API_HASH, key: env.ACCOUNTS_KEY,
    report: (message) => toApi('account-message', message),
    reportTyping: (typing) => toApi('account-typing', typing),
  });
  (async () => {
    for (;;) {
      await sender.tick().catch((e) => console.error('аккаунты:', e.message));
      await sleep(Number(env.SENDER_POLL_MS ?? 4000));
    }
  })();
} else console.log('Аккаунты для переписки выключены: нужны ACCOUNTS_KEY, API_URL и COLLECTOR_SECRET');

const cursors = await store.cursors();
await store.addSources(channels);

// Канал организатора — тоже источник: у него свои события. Каждый новый канал при первом чтении ищется по username
// (флудоопасно) и отдаёт до 100 публикаций в ИИ, поэтому добавляем по несколько за проход.
// ponytail: при перезапуске GramJS заново ищет все источники; если их станут сотни — хранить сущности в сессии.
const ADOPT_PER_PASS = Number(env.ADOPT_PER_PASS ?? 5);

async function pollChannel({ channel, host_username }, known) {
  const fresh = (await fetchChatAnnouncements(userbot, channel, cursors[channel] ?? 0))
    .sort((a, b) => a.announcement.number - b.announcement.number);
  for (const { announcement, album } of fresh) {
    const candidate = Date.now() - new Date(announcement.published_at) < maxAgeMs && looksLikeEvent(announcement.text);
    // Фото качаем только для кандидатов: их видит ИИ (афиша) и, если событие новое, они уходят в бакет.
    const photos = candidate ? await downloadPhotos(userbot, album) : [];
    const events = candidate ? await extract({ ...announcement, images: photos.slice(0, 1).map((p) => p.data) }) : []; // ИИ — только первое фото: афиша обычно первая, остальные стоят токенов зря
    let media; // фото и видео публикации в бакете: заливаем один раз, когда из неё появилось новое событие
    if (candidate) await sleep(llmPauseMs); // бесплатный уровень Gemini считает запросы в минуту
    for (const [i, event] of events.entries()) {
      if (new Date(event.ends_at ?? event.starts_at) < Date.now()) continue; // уже прошло
      event.telegram_username = contactFor(event, channel, host_username);
      const same = known.find((k) => isSameEvent(k.event, event));
      // Канал организатора в источники попал сам, без решения команды: событие, которое она уже проверила, он не меняет.
      if (same && host_username && same.status !== 'pending') continue;
      // Событие без контакта не берём: записаться некуда. Появится контакт в другом посте — склеится или создастся там.
      if (!same && !event.telegram_username && !event.whatsapp_phone) continue;
      const merged = same ? mergeEvents(same.event, event) : event;
      if (same && JSON.stringify(merged) === JSON.stringify(same.event)) continue; // повтор без новых сведений
      // Дубль дополняет запись первого анонса, а не создаёт вторую.
      const external_id = same?.external_id ?? `telegram:${announcement.id}#${i}`;
      if (!same && bucket) media ??= await saveMedia(announcement, photos, album);
      await store.upsert({
        external_id, channel, announcement: media?.length ? { ...announcement, media } : announcement, event: merged,
        signup_url: signupUrl(merged, announcement, signupMessage),
      });
      if (same) same.event = merged; else known.push({ external_id, event, status: 'pending' });
    }
    // Сдвигаем отметку только после записи событий: упали посередине — повторим с этой же публикации.
    cursors[channel] = announcement.number;
    await store.saveCursor(channel, announcement.number);
    console.log(`${announcement.id}: ${candidate ? `событий ${events.length}` : 'отсеяно до ИИ'}`);
  }
}

/**
 * Фото и видео публикации в бакете по порядку альбома: [{ type, url }]. Ключ — канал/публикация/сообщение, повторная
 * заливка перезаписывает тот же файл. Сбой бакета событие не останавливает: оно сохранится без медиа.
 */
async function saveMedia(announcement, photos, album) {
  const files = [
    ...photos.map((p) => ({ ...p, type: 'photo', mime: 'image/jpeg', ext: 'jpg' })),
    ...(await downloadVideos(userbot, album)).map((v) => ({ ...v, type: 'video', mime: v.type, ext: v.type.split('/')[1] ?? 'mp4' })),
  ].sort((a, b) => a.number - b.number);
  const key = (f) => `telegram/${announcement.id.replace(/\/\d+$/, '')}/${f.number}.${f.ext}`;
  try {
    const media = [];
    for (const f of files) media.push({ type: f.type, url: await bucket.put(key(f), f.data, f.mime) });
    return media;
  } catch (e) {
    console.error(`медиа ${announcement.id}: ${e.message}`);
    return [];
  }
}

do {
  // Сбой дозаполнения (ИИ перегружен, лимит) не должен останавливать сбор: остаток доберём следующим проходом.
  await backfillTopics({ store, extract, pause: () => sleep(llmPauseMs) }).catch((e) => console.error('дозаполнение:', e.message));
  const adopted = await store.adoptHostChannels(ADOPT_PER_PASS).catch((e) => console.error('источники:', e.message));
  if (adopted?.length) console.log(`новые источники от организаторов: ${adopted.map((c) => `@${c}`).join(', ')}`);
  const known = await store.upcoming();
  for (const source of await store.sources()) {
    await pollChannel(source, known).catch((e) => console.error(`${source.channel}: ${e.message}`));
    await sleep(2000); // не частим с запросами к Telegram
  }
  for (const chat of env.API_URL && env.COLLECTOR_SECRET ? leadChats : []) {
    await pollLeads(chat).catch((e) => console.error(`вопросы ${chat}: ${e.message}`));
    await sleep(2000);
  }
  await refreshPosts().catch((e) => console.error(`публикации: ${e.message}`));
  await profileHosts().catch((e) => console.error(`профили: ${e.message}`));
  await refreshPhotos().catch((e) => console.error(`фото: ${e.message}`));
  if (pollMinutes) await sleep(pollMinutes * 60_000);
} while (pollMinutes);
await userbot.disconnect();
await store.end();
process.exit(0); // GramJS держит таймеры и сам не отпускает процесс
