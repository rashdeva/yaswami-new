import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { createExtractor, createOfferExtractor, createPracticeClassifier, createProductExtractor, createSearchMatcher, createSummarizer, createTopicProposer, isSameEvent, looksLikeEvent, mergeEvents } from '@yaswami/extract';
import { signupUrl } from './signup.mjs';
import { connect, goneReason, loadPeers, newPeers, downloadCover, downloadPhotos, downloadVideos, fetchAlbum, fetchChatAnnouncements, fetchPosts, toStats } from './mtproto.mjs';
import { refreshOld } from './refresh.mjs';
import { createBucket } from './bucket.mjs';
import { curateTopics, syncTopics } from './topics.mjs';
import { createStore } from './store.mjs';
import { contactFor, fetchChannelPhotos, fetchProfile } from './host.mjs';
import { backfillTopics, classifyPractices } from './backfill.mjs';
import { createSender } from './sender.mjs';
import { fetchLeads } from './lead.mjs';
import { resolveAuthor, saveOffers } from './offers.mjs';
import { pickProducts, saveProducts, uploadFirstPhoto } from './products.mjs';
import { collectedCoverKey, PRODUCT_TTL_DAYS } from '@yaswami/core';
import { searchChannels, TOPICS } from './find-sources.mjs';
import { cityMatcher } from './city.mjs';
import { candidatesFrom, cityHashtags, createInstagram, download, mediaOf, toAnnouncement as fromInstagram, toJpeg, toStats as instagramStats } from './instagram.mjs';
import { instagramOf } from '@yaswami/core';

const env = process.env;
// Источники живут в таблице sources (раздел «Источники» в админке); CHANNELS при старте только дополняет её.
const channels = (env.CHANNELS ?? '').split(',').map((c) => c.trim().replace(/^@/, '')).filter(Boolean);
if (!env.TG_SESSION) throw new Error('TG_SESSION пуст: выполни pnpm --filter @yaswami/collector run login');
if (!env.DATABASE_URL) throw new Error('DATABASE_URL пуст');
const userbot = connect({ apiId: env.TG_API_ID, apiHash: env.TG_API_HASH, session: env.TG_SESSION });
const store = createStore(env.DATABASE_URL);
const bucket = createBucket();
// Instagram — через Apify (instagram.mjs); без APIFY_TOKEN не читаем и не ищем.
const instagram = createInstagram({ token: env.APIFY_TOKEN, maxUsd: Number(env.APIFY_MAX_USD ?? 0.5) });
if (!instagram) console.log('Instagram выключен: нужен APIFY_TOKEN');
if (!bucket) console.log('Фото и видео анонсов не сохраняются: нужны S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY и MEDIA_PUBLIC_URL');
const llmPauseMs = Number(env.LLM_PAUSE_MS ?? 4500); // ≈13 запросов в минуту при лимите 15
const maxAgeMs = Number(env.MAX_AGE_DAYS ?? 14) * 86_400_000; // старые публикации в ИИ не отправляем
const pollMinutes = Number(env.POLL_MINUTES ?? 15);
const signupMessage = env.SIGNUP_MESSAGE ?? 'Привет! Я нашёл событие «{title}» на Ясвами, хочу записаться.';
// Разбор анонса — свой на каждый город источника: ИИ знает название города и пишет время в его часовом поясе.
const extractors = new Map();
const extractFor = ({ city, timezone }) => extractors.get(`${city}|${timezone}`)
  ?? extractors.set(`${city}|${timezone}`, createExtractor({ model: env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite', city, timezone })).get(`${city}|${timezone}`);
// Повторный разбор уже собранных событий (backfill.mjs, refresh.mjs): в городе и поясе самого события ({ city, timezone }).
const extract = (announcement, place) => extractFor(place)(announcement);

// У каждой модели Gemini свой дневной лимит бесплатного уровня, и одна модель на всё кончалась к полудню. Анонсы и
// объявления мастеров — EXTRACT_MODEL; разметка услуг, товары, справки и запросы организаторов — SIDE_MODEL, со своим
// лимитом. Исчерпанную модель подменяет запасная (packages/extract/src/gemini.ts, GEMINI_FALLBACK_MODELS).
const sideModel = env.SIDE_MODEL ?? 'gemini-3.1-flash-lite';
const summarize = createSummarizer({ model: sideModel });
const extractOffer = createOfferExtractor({ model: env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite' });
const extractProducts = createProductExtractor({ model: sideModel });
const classifyPractice = createPracticeClassifier({ model: sideModel });
// Новая тема из меток: TOPIC_MODEL — модель для неё (гид читают все, можно взять посильнее), TOPICS_AUTO=0 — не добавлять темы самому.
const proposeTopic = createTopicProposer({ model: env.TOPIC_MODEL ?? env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite' });
const matcher = createSearchMatcher({ model: sideModel });
// Поиск по username — самый флудоопасный вызов Telegram: за проход собираем немного профилей, остальные — в следующий.
const PROFILES_PER_PASS = 15;
// Профиль пересматриваем раз в неделю: «о себе» и канал меняются, а по каналу берутся фото и источник.
const PROFILE_REFRESH_DAYS = Number(env.PROFILE_REFRESH_DAYS ?? 7);
// Username, под которыми не человек (канал, бот, никого). ponytail: помним только в памяти процесса —
// после перезапуска проверим ещё раз; при POLL_MINUTES=0 (cron) это надо класть в базу.
const notPeople = new Set();

async function profileHosts() {
  // Сначала те, кого команда добавила по username в админке: их ждут.
  const requested = await store.requestedHosts();
  // Город организатора, найденного по событию, — город этого события; у заготовки команды город уже стоит.
  const cityOf = new Map((await store.unprofiled()).map((r) => [r.username, r.city_id]));
  const usernames = [...new Set([...requested, ...[...cityOf.keys()].filter((u) => !notPeople.has(u))])].slice(0, PROFILES_PER_PASS);
  for (const username of usernames) {
    const profile = await fetchProfile(userbot, username);
    if (profile) {
      const { telegram_id, name, bio, channel } = profile;
      const city = requested.includes(username) || !cityOf.has(username) ? {} : { city_id: cityOf.get(username) };
      await store.saveHost({ telegram_id, username, name, bio, channel: channel?.username ?? null, summary: await summarize(profile), ...city });
    } else if (requested.includes(username)) await store.rejectRequestedHost(username);
    else notPeople.add(username);
    console.log(`@${username}: ${profile ? `профиль${profile.channel ? `, канал @${profile.channel.username}` : ''}` : 'не человек и не канал'}`);
    await sleep(llmPauseMs);
  }
  // Оставшиеся места прохода — тем, чей профиль давно не смотрели: человек мог сменить «о себе» или завести канал.
  const left = PROFILES_PER_PASS - usernames.length;
  for (const host of left > 0 ? await store.staleProfiles(PROFILE_REFRESH_DAYS, left) : []) {
    const profile = await fetchProfile(userbot, host.username);
    // Под username теперь другой человек или никого: чужое в профиль не пишем.
    if (profile?.telegram_id !== Number(host.telegram_id)) await store.profileChecked(host.telegram_id);
    else await store.refreshHost({ telegram_id: profile.telegram_id, bio: profile.bio, channel: profile.channel?.username ?? null, summary: host.has_summary ? null : await summarize(profile) });
    console.log(`@${host.username}: ${profile?.telegram_id === Number(host.telegram_id) ? 'профиль обновлён' : 'под username уже не он — не обновляем'}`);
    await sleep(host.has_summary ? 2000 : llmPauseMs);
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

/** Фото анонса как обложка: есть бакет — файл туда, в базу только адрес (ADR-0011); нет — байты в базу, как раньше. */
async function saveCover(external_id, source, data) {
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
  const place = bucket ? { url: await bucket.put(collectedCoverKey(external_id, hash), data, 'image/jpeg') } : { data };
  await store.saveCover(external_id, source, place);
}

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
        if (cover) await saveCover(external_id, `telegram:${chat}/${number}`, cover);
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

// Чаты, где ищем не анонсы, — источники с kind leads (store.chats()): у каждого свой город, его получают
// мастера. LEAD_CHATS (username без @ через запятую) лишь добавляются туда при старте, дальше
// чатами управляет команда в админке («Источники»).
const chatList = (value) => (value ?? '').split(',').map((c) => c.trim().replace(/^@/, '')).filter(Boolean);

/** Включённые Запросы организаторов; тем, у кого ещё нет ключевых слов (новый или переписанный), их выводит ИИ. */
async function activeSearches() {
  const searches = await store.activeSearches();
  for (const search of searches.filter((s) => !s.keywords)) {
    // Не вышло (лимит ИИ) — этот Запрос пропускает проход, остальные ищутся.
    search.keywords = await matcher.keywords(search.query).catch((e) => (console.error(`слова запроса ${search.id}: ${e.message}`), null));
    if (search.keywords) await store.saveSearchKeywords(search.id, search.query, search.keywords);
    await sleep(llmPauseMs);
  }
  return searches;
}

/** Один чат города: вопросы — в API, Находки и мастера — в базу. */
async function pollLeads({ chat, city_id, city }, searches) {
  const key = `lead:${chat}`; // отметка в той же таблице, что у каналов с анонсами
  const { last, read, leads, offers, candidates } = await fetchLeads(userbot, chat, cursors[key] ?? 0, { searches });
  for (const lead of leads) await toApi('lead', lead);
  // Кандидатов в Находки проверяет ИИ: ключевые слова ловят и тех, кто сам предлагает услугу.
  // ponytail: каждый кандидат — запрос к ИИ; если слова Запроса окажутся слишком общими, ограничить число за проход.
  let found = 0;
  for (const { searches: fit, ...message } of candidates) {
    const ids = await matcher.matching(message.text, fit).catch((e) => (console.error(`находки ${message.url}: ${e.message}`), []));
    for (const search_id of ids) await store.saveSearchMatch({ search_id, ...message });
    found += ids.length ? 1 : 0;
    await sleep(llmPauseMs);
  }
  if (last !== cursors[key]) await store.saveCursor(key, (cursors[key] = last));
  const masters = await saveOffers({ store, extractOffer, resolve: (u) => resolveAuthor(userbot, u), pause: () => sleep(llmPauseMs), city_id, city }, offers);
  // Каждый проход — в журнал: иначе не отличить «вопросов нет» от «чат не читается».
  console.log(`вопросы ${chat}: прочитано ${read}, похоже на «куда сходить» — ${leads.length}, мастеров ${masters} из ${offers.length}, находок ${found} из ${candidates.length}`);
}

/**
 * Один источник товаров (канал мастера или группа объявлений): новые посты — в ИИ, товары — в базу. Посты старше
 * PRODUCT_TTL_DAYS гость всё равно бы не увидел — их не разбираем. Анонсы, вопросы и мастера-услуги отсюда не берутся.
 */
async function pollProducts(source) {
  const key = `product:${source.channel}`; // отметка в той же таблице, что у каналов с анонсами
  const chat = /^-?\d+$/.test(source.channel) ? Number(source.channel) : source.channel;
  const messages = (await userbot.getMessages(chat, { limit: 100, minId: cursors[key] ?? 0 })).reverse();
  if (!messages.length) return;
  const posts = pickProducts(source.channel, messages, { maxAgeMs: PRODUCT_TTL_DAYS * 86_400_000 });
  const { products, hosts } = await saveProducts({
    store, extractProducts, resolve: (u) => resolveAuthor(userbot, u), pause: () => sleep(llmPauseMs),
    photo: (post) => uploadFirstPhoto({ bucket, downloadPhotos: (album) => downloadPhotos(userbot, album) }, post),
  }, source, posts);
  // Отметка — после записи: упали посередине (FLOOD_WAIT) — перечитаем эти же сообщения.
  await store.saveCursor(key, (cursors[key] = messages.at(-1).id));
  console.log(`товары ${source.channel}: прочитано ${messages.length}, похоже на товары ${posts.length}, записано ${products} у мастеров: ${hosts}`);
}

// Railway проверяет /health при деплое (настройка сервиса на Railway) и гасит старый контейнер, только когда новый ответил.
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

// Каналы, найденные раньше этим аккаунтом, — сразу в сессию: после перезапуска (выкладки) не ищем их по username заново.
await userbot.connect();
const account = String((await userbot.getMe()).id);
const peers = await store.peers(account);
loadPeers(userbot, peers);
const savedPeers = new Set(peers.map((p) => p.username));
async function savePeers() {
  const fresh = newPeers(userbot, savedPeers);
  await store.savePeers(account, fresh);
  for (const p of fresh) savedPeers.add(p.username);
}

/** Сбой чтения источника: канала больше нет — выключаем с причиной, чтобы не искать его каждый проход; иначе — в журнал. */
async function failed(channel, label, e) {
  const reason = goneReason(e);
  if (reason) await store.disableSource(channel, reason);
  console.error(`${label}: ${e.message}${reason ? ' — источник выключен' : ''}`);
}

// Отметки читаем заново каждый проход (ниже): команда сбрасывает отметку источника, чтобы перечитать его свежие публикации.
let cursors = await store.cursors();
await store.requeueSourceSearches();
// Канал, который уже есть в источниках с другим видом, не переделываем — вид правит команда; но говорим о нём:
// иначе чат из LEAD_CHATS молча остался бы источником анонсов и вопросы из него не собирались бы.
for (const [list, kind] of [[channels, 'announcements'], [chatList(env.LEAD_CHATS), 'leads']]) {
  for (const s of await store.addSources(list, kind)) console.warn(`источник @${s.channel} — вид ${s.kind}, а в окружении он как ${kind}: поменяйте вид в админке («Источники»), если нужно`);
}

// Канал организатора — тоже источник: у него свои события. Каждый новый канал при первом чтении ищется по username
// (флудоопасно) и отдаёт до 100 публикаций в ИИ, поэтому добавляем по несколько за проход.
const ADOPT_PER_PASS = Number(env.ADOPT_PER_PASS ?? 5);

// Источник, события которого команда стабильно одобряет, модерацию пропускает (store.trustedChannels). 0 — выключено.
const AUTO_APPROVE_MIN = Number(env.AUTO_APPROVE_MIN ?? 5);

// Источник, где ИИ столько публикаций подряд не нашёл ни одного события, выключается (store.countParse): каждый разбор —
// запрос из общей квоты ИИ, а такие каналы — магазины, блоги и чаты, где время пишут не про события. 0 — не выключать.
const SOURCE_EMPTY_PARSES = Number(env.SOURCE_EMPTY_PARSES ?? 20);

// Поиск источников для городов (source_searches): новому городу — в первый же проход, остальным — раз в
// SOURCE_SEARCH_DAYS дней (0 — только по просьбе команды). Канал, где за месяц SOURCE_AUTO_ADD_MIN и больше публикаций
// похожи на анонс, становится источником сам: его события всё равно идут через модерацию. Группы и остальное ждут
// команду в «Городах»: из чатов города уходят ответы людям, такое решает человек.
const SOURCE_SEARCH_DAYS = Number(env.SOURCE_SEARCH_DAYS ?? 30);
const SOURCE_AUTO_ADD_MIN = Number(env.SOURCE_AUTO_ADD_MIN ?? 3);
// ponytail: по одному слову на тему — 19 запросов на каждое написание города по 3 с, у Дананга с пятью написаниями
// поиск идёт минут 8 раз в месяц; шире — упрёмся в флуд-лимиты Telegram.
const CITY_WORDS = {
  '': [''], город: ['афиша', 'события', 'events', 'чат', 'chat'],
  ...Object.fromEntries(Object.entries(TOPICS).map(([topic, words]) => [topic, words.slice(0, 1)])),
};

async function sourceSearch() {
  if (SOURCE_SEARCH_DAYS > 0) await store.queueSourceSearches(SOURCE_SEARCH_DAYS);
  const search = await store.takeSourceSearch();
  if (!search) return;
  try {
    const results = (await searchChannels(userbot, { names: search.names, local: cityMatcher(search.names), words: CITY_WORDS }))
      .map(({ topic, ...r }) => r);
    // Instagram — по хэштегам города; его сбой не отменяет найденное в Telegram.
    if (instagram) results.push(...await instagram.hashtags(cityHashtags(search.names)).then(candidatesFrom)
      .catch((e) => (console.error(`поиск в Instagram ${search.city_id}: ${e.message}`), [])));
    const strong = SOURCE_AUTO_ADD_MIN > 0 ? results.filter((r) => r.kind === 'announcements' && r.event_like >= SOURCE_AUTO_ADD_MIN) : [];
    const added = await store.addFoundSources(search.city_id, strong.map((r) => r.channel));
    await store.finishSourceSearch(search.id, { results });
    console.log(`поиск источников ${search.city_id}: найдено ${results.length}, в источники — ${added.join(', ') || 'никого'}`);
  } catch (e) {
    await store.finishSourceSearch(search.id, { error: e.message });
    throw e;
  }
}

async function pollChannel(source, known, trusted) {
  const { channel } = source;
  const fresh = (await fetchChatAnnouncements(userbot, channel, cursors[channel] ?? 0))
    .sort((a, b) => a.announcement.number - b.announcement.number);
  for (const { announcement, album } of fresh) {
    if (source.off) break;
    const candidate = Date.now() - new Date(announcement.published_at) < maxAgeMs && looksLikeEvent(announcement.text);
    // Фото качаем только для кандидатов: их видит ИИ (афиша) и, если событие новое, они уходят в бакет.
    const photos = candidate ? await downloadPhotos(userbot, album) : [];
    const events = candidate ? await saveEvents(source, announcement, photos, () => saveMedia(announcement, photos, album), known, trusted) : 0;
    // Сдвигаем отметку только после записи событий: упали посередине — повторим с этой же публикации.
    cursors[channel] = announcement.number;
    await store.saveCursor(channel, announcement.number);
    console.log(`${announcement.id}: ${candidate ? `событий ${events}` : 'отсеяно до ИИ'}`);
  }
}

/**
 * События одной публикации-кандидата: разбор ИИ, склейка с известными, запись. `upload` заливает медиа публикации
 * в бакет — один раз, когда из неё появилось новое событие. `cover` — обложка нового события (JPEG) или null: у Telegram
 * её кладёт refreshPosts, у Instagram — сразу, потом публикацию не перечитываем. Возвращает, сколько событий нашёл ИИ.
 */
async function saveEvents(source, announcement, photos, upload, known, trusted, cover = null) {
  const { channel, host_username, city_id, city, timezone } = source;
  const events = await extractFor({ city, timezone })({ ...announcement, images: photos.slice(0, 1).map((p) => p.data) }); // ИИ — только первое фото: афиша обычно первая, остальные стоят токенов зря
  await sleep(llmPauseMs); // бесплатный уровень Gemini считает запросы в минуту
  // Считаем только состоявшийся разбор: сбой ИИ (квота, перегрузка) бросает выше и источник не штрафует.
  if (await store.countParse(channel, events.length > 0, SOURCE_EMPTY_PARSES)) {
    source.off = true; // остальные публикации этого прохода в ИИ уже не идут
    console.log(`источник ${channel}: ${SOURCE_EMPTY_PARSES} разборов подряд без событий — выключен`);
  }
  const ig = instagramOf(channel);
  let media; // фото и видео публикации в бакете: заливаем один раз, когда из неё появилось новое событие
  for (const [i, event] of events.entries()) {
    if (new Date(event.ends_at ?? event.starts_at) < Date.now()) continue; // уже прошло
    // В Instagram ник профиля — не контакт в Telegram (contactFor отбросит его как «сам канал»); записаться можно в директ.
    event.telegram_username = contactFor(event, ig ?? channel, host_username);
    if (ig) event.instagram_username = ig;
    const same = known.find((k) => k.city_id === city_id && isSameEvent(k.event, event));
    // Канал организатора в источники попал сам, без решения команды: событие, которое она уже проверила, он не меняет.
    const decided = same && same.status !== 'pending';
    if (decided && host_username) continue;
    // Событие без контакта не берём: записаться некуда. Появится контакт в другом посте — склеится или создастся там.
    if (!same && !event.telegram_username && !event.whatsapp_phone && !event.instagram_username) continue;
    // Проверенному событию анонс из общего источника дописывает сведения, но не контакт для записи: иначе чужой пост
    // с похожим названием увёл бы «Записаться» к своему автору.
    const merged = !same ? event : decided
      ? { ...mergeEvents(same.event, event), telegram_username: same.event.telegram_username, whatsapp_phone: same.event.whatsapp_phone, instagram_username: same.event.instagram_username ?? null, url: same.event.url }
      : mergeEvents(same.event, event);
    if (same && JSON.stringify(merged) === JSON.stringify(same.event)) continue; // повтор без новых сведений
    // Дубль дополняет запись первого анонса, а не создаёт вторую.
    const external_id = same?.external_id ?? `${ig ? 'instagram' : 'telegram'}:${announcement.id}#${i}`;
    if (!same && bucket) media ??= await upload();
    const status = trusted.has(channel) ? 'approved' : 'pending'; // у известного события upsert статус не меняет
    await store.upsert({
      external_id, channel, city_id, announcement: media ? { ...announcement, media } : announcement, event: merged,
      signup_url: signupUrl(merged, announcement, signupMessage), status,
    });
    if (!same && cover) await saveCover(external_id, `instagram:${announcement.id}`, cover);
    if (same) same.event = merged; else known.push({ external_id, city_id, event, status });
    if (!same && status === 'approved') console.log(`${external_id}: одобрено само — доверенный источник`);
  }
  return events.length;
}

// Профили Instagram читаем раз в INSTAGRAM_POLL_HOURS часов: Apify берёт деньги за каждую публикацию, а организаторы
// анонсируют за дни. ponytail: время прошлого чтения — в памяти, после перезапуска читаем сразу.
const INSTAGRAM_POLL_HOURS = Number(env.INSTAGRAM_POLL_HOURS ?? 6);
const INSTAGRAM_PHOTO_MAX = 10_000_000; // до пережатия: после toJpeg — сотни КБ
const INSTAGRAM_COVER_SIDE = 800; // как обложка из Telegram (COVER_SIDE в mtproto.mjs)
const INSTAGRAM_VIDEO_MAX = 50_000_000; // как у Telegram: длинные эфиры не тащим
let instagramReadAt = 0;

async function pollInstagram(known, trusted) {
  if (!instagram || Date.now() - instagramReadAt < INSTAGRAM_POLL_HOURS * 3_600_000) return;
  // События, собранные до обложек из Instagram: обложка — первое фото публикации из нашего бакета.
  for (const { external_id, url } of await store.instagramWithoutCover()) {
    const file = await download(url, INSTAGRAM_PHOTO_MAX);
    const cover = file && await toJpeg(file.data, INSTAGRAM_COVER_SIDE, 78);
    if (cover && cover.data.length <= 400_000) await saveCover(external_id, `instagram:${external_id.replace(/^instagram:|#\d+$/g, '')}`, cover.data);
  }
  const sources = await store.instagramSources();
  if (!sources.length) return;
  instagramReadAt = Date.now();
  // Один запуск на все профили, с самой ранней отметки: запуск на каждый профиль дороже. Лишнее отсекаем по отметке ниже.
  const oldest = Math.min(...sources.map((s) => cursors[s.channel] ?? 0)) * 1000;
  const posts = await instagram.posts(sources.map((s) => instagramOf(s.channel)), new Date(Math.max(oldest, Date.now() - maxAgeMs)));
  const byHandle = Map.groupBy(posts, (p) => p.ownerUsername?.toLowerCase());
  for (const source of sources) {
    const fresh = (byHandle.get(instagramOf(source.channel)) ?? [])
      .map((post) => ({ post, announcement: fromInstagram(post) }))
      .filter(({ announcement }) => announcement.number > (cursors[source.channel] ?? 0))
      .sort((a, b) => a.announcement.number - b.announcement.number);
    try {
      for (const { post, announcement } of fresh) {
        if (source.off) break;
        const candidate = Date.now() - new Date(announcement.published_at) < maxAgeMs && looksLikeEvent(announcement.text);
        // Фото — только кандидатам, ролик — только когда из публикации появилось новое событие.
        const photos = candidate ? await downloadInstagram(post, 'photo') : [];
        const upload = async () => uploadMedia(`instagram/${announcement.id}`, [...photos, ...await downloadInstagram(post, 'video')]);
        const cover = photos.length ? await toJpeg(photos[0].data, INSTAGRAM_COVER_SIDE, 78) : null;
        const events = candidate ? await saveEvents(source, announcement, photos, upload, known, trusted, cover && cover.data.length <= 400_000 ? cover.data : null) : 0;
        if (events) await store.setStats(`instagram:${announcement.id}#`, instagramStats(post));
        cursors[source.channel] = announcement.number;
        await store.saveCursor(source.channel, announcement.number);
        console.log(`instagram ${announcement.id}: ${candidate ? `событий ${events}` : 'отсеяно до ИИ'}`);
      }
    } catch (e) {
      console.error(`${source.channel}: ${e.message}`);
    }
  }
}

/**
 * Фото (`type` photo) или ролик публикации Instagram: [{ type, data, mime, ext, number, width, height }]. Фото пережимаем
 * в JPEG до 1280 px (toJpeg): его видит ИИ и сайт. Не скачалось или не картинка — пропускаем.
 */
async function downloadInstagram(post, type) {
  const files = [];
  for (const m of mediaOf(post).filter((m) => m.type === type)) {
    const file = await download(m.url, type === 'photo' ? INSTAGRAM_PHOTO_MAX : INSTAGRAM_VIDEO_MAX);
    if (!file) continue;
    if (type === 'video') { files.push({ data: file.data, type, number: m.number, ext: 'mp4', mime: 'video/mp4', width: m.width, height: m.height }); continue; }
    const jpeg = await toJpeg(file.data);
    if (jpeg) files.push({ ...jpeg, type, number: m.number, ext: 'jpg', mime: 'image/jpeg' });
  }
  return files;
}

/**
 * Фото и видео публикации в бакете по порядку альбома: [{ type, url }]. Ключ — канал/публикация/сообщение, повторная
 * заливка перезаписывает тот же файл. Сбой бакета событие не останавливает: оно сохранится без медиа (null).
 */
async function saveMedia(announcement, photos, album) {
  const files = [
    ...photos.map((p) => ({ ...p, type: 'photo', mime: 'image/jpeg', ext: 'jpg' })),
    ...(await downloadVideos(userbot, album)).map((v) => ({ ...v, type: 'video', mime: v.type, ext: v.type.split('/')[1] ?? 'mp4' })),
  ].sort((a, b) => a.number - b.number);
  return uploadMedia(`telegram/${announcement.id.replace(/\/\d+$/, '')}`, files);
}

/** Файлы публикации в бакет под `prefix`: [{ type, url, width, height }]; сбой бакета — null, событие сохранится без медиа. */
async function uploadMedia(prefix, files) {
  // Размер в ключе: файл другого размера — другой адрес, CDN не отдаст старую копию.
  const key = (f) => `${prefix}/${f.number}_${f.width ?? 0}x${f.height ?? 0}.${f.ext}`;
  try {
    const media = [];
    for (const f of files) media.push({ type: f.type, url: await bucket.put(key(f), f.data, f.mime), width: f.width ?? null, height: f.height ?? null });
    return media;
  } catch (e) {
    console.error(`медиа ${prefix}: ${e.message}`);
    return null;
  }
}

do {
  // Темы — из базы; новая тема из накопившихся меток — не больше одной за проход.
  await syncTopics({ store }).catch((e) => console.error('темы:', e.message));
  // Темы заводит хранитель тем (роль agents/librarian, ADR-0010): он видит тех же кандидатов (admin_topics_candidates)
  // и ещё переносит события и выключает лишнее. Старое поведение — сборщик сам делает тему из метки — TOPICS_AUTO=1.
  if (env.TOPICS_AUTO === '1') await curateTopics({ store, proposeTopic }).catch((e) => console.error('новая тема:', e.message));
  // Сбой дозаполнения (ИИ перегружен, лимит) не должен останавливать сбор: остаток доберём следующим проходом.
  await backfillTopics({ store, extract, pause: () => sleep(llmPauseMs) }).catch((e) => console.error('дозаполнение:', e.message));
  await classifyPractices({ store, classifyPractice, limit: Number(env.PRACTICES_PER_PASS ?? 20), pause: () => sleep(llmPauseMs) })
    .catch((e) => console.error('разбор услуг:', e.message));
  const adopted = await store.adoptHostChannels(ADOPT_PER_PASS).catch((e) => console.error('источники:', e.message));
  if (adopted?.length) console.log(`новые источники от организаторов: ${adopted.map((c) => `@${c}`).join(', ')}`);
  const adoptedIg = instagram ? await store.adoptHostInstagram(ADOPT_PER_PASS).catch((e) => console.error('Instagram организаторов:', e.message)) : null;
  if (adoptedIg?.length) console.log(`новые источники из Instagram организаторов: ${adoptedIg.join(', ')}`);
  const known = await store.upcoming();
  cursors = await store.cursors();
  const trusted = new Set(AUTO_APPROVE_MIN > 0 ? await store.trustedChannels(AUTO_APPROVE_MIN) : []);
  // Товары — до анонсов: источников мало, а анонсы с Instagram занимают десятки минут, и товары ждали бы их каждый проход.
  for (const source of await store.productSources()) {
    await pollProducts(source).catch((e) => failed(source.channel, `товары ${source.channel}`, e));
    await sleep(2000);
  }
  for (const source of await store.sources()) {
    await pollChannel(source, known, trusted).catch((e) => failed(source.channel, source.channel, e));
    await sleep(2000); // не частим с запросами к Telegram
  }
  await pollInstagram(known, trusted).catch((e) => console.error(`Instagram: ${e.message}`));
  await savePeers().catch((e) => console.error(`каналы: ${e.message}`));
  await sourceSearch().catch((e) => console.error(`поиск источников: ${e.message}`));
  // Вопросы уходят в API: без его адреса чаты города не читаем.
  const chats = env.API_URL && env.COLLECTOR_SECRET ? await store.chats() : [];
  const searches = chats.length ? await activeSearches().catch((e) => (console.error(`запросы организаторов: ${e.message}`), [])) : [];
  for (const chat of chats) {
    await pollLeads(chat, searches).catch((e) => failed(chat.chat, `вопросы ${chat.chat}`, e));
    await sleep(2000);
  }
  await refreshPosts().catch((e) => console.error(`публикации: ${e.message}`));
  // Старые события — по REFRESH_PER_PASS публикаций за проход; без бакета не трогаем: медиа некуда класть.
  if (bucket) await refreshOld({
    store, extract, saveMedia, limit: Number(env.REFRESH_PER_PASS ?? 15), pause: () => sleep(llmPauseMs),
    fetchAlbum: (id) => fetchAlbum(userbot, id), downloadPhotos: (album) => downloadPhotos(userbot, album),
  }).catch((e) => console.error(`повторный разбор: ${e.message}`));
  await profileHosts().catch((e) => console.error(`профили: ${e.message}`));
  await refreshPhotos().catch((e) => console.error(`фото: ${e.message}`));
  await savePeers().catch((e) => console.error(`каналы: ${e.message}`));
  if (pollMinutes) await sleep(pollMinutes * 60_000);
} while (pollMinutes);
await userbot.disconnect();
await store.end();
process.exit(0); // GramJS держит таймеры и сам не отпускает процесс
