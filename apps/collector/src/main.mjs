import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { createExtractor, createJobExtractor, createOfferExtractor, createSearchMatcher, createSummarizer, createTopicProposer, isSameEvent, looksLikeEvent, mergeEvents } from '@yaswami/extract';
import { signupUrl } from './signup.mjs';
import { connect, goneReason, loadPeers, newPeers, downloadCover, downloadPhotos, downloadVideos, fetchAlbum, fetchChatAnnouncements, fetchPosts, toStats } from './mtproto.mjs';
import { refreshOld } from './refresh.mjs';
import { createBucket } from './bucket.mjs';
import { curateTopics, syncTopics } from './topics.mjs';
import { createStore } from './store.mjs';
import { contactFor, fetchChannelPhotos, fetchProfile } from './host.mjs';
import { backfillTopics } from './backfill.mjs';
import { createSender } from './sender.mjs';
import { fetchLeads } from './lead.mjs';
import { saveJobs } from './jobs.mjs';
import { resolveAuthor, saveOffers } from './offers.mjs';
import { searchChannels, TOPICS } from './find-sources.mjs';
import { cityMatcher } from './city.mjs';

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
// Разбор анонса — свой на каждый город источника: ИИ знает название города и пишет время в его часовом поясе.
const extractors = new Map();
const extractFor = ({ city, timezone }) => extractors.get(`${city}|${timezone}`)
  ?? extractors.set(`${city}|${timezone}`, createExtractor({ model: env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite', city, timezone })).get(`${city}|${timezone}`);
// Повторный разбор уже собранных событий (backfill.mjs, refresh.mjs): в городе и поясе самого события ({ city, timezone }).
const extract = (announcement, place) => extractFor(place)(announcement);

const summarize = createSummarizer({ model: env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite' });
const extractOffer = createOfferExtractor({ model: env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite' });
// Новая тема из меток: TOPIC_MODEL — модель для неё (гид читают все, можно взять посильнее), TOPICS_AUTO=0 — не добавлять темы самому.
const proposeTopic = createTopicProposer({ model: env.TOPIC_MODEL ?? env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite' });
const extractJob = createJobExtractor({ model: env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite' });
const matcher = createSearchMatcher({ model: env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite' });
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

// Чаты, где ищем не анонсы, — источники с kind leads и jobs (store.chats()): у каждого свой город, его получают
// мастера и вакансии. LEAD_CHATS и JOB_CHATS (username без @ через запятую) лишь добавляются туда при старте, дальше
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

/** Один чат: вакансии — всегда; вопросы, Находки и мастера — только при `leads` (чат с kind leads и есть API). */
async function pollLeads({ chat, city_id, city }, leads_too, searches) {
  const key = `lead:${chat}`; // отметка в той же таблице, что у каналов с анонсами; у чатов о работе ключ того же вида
  const { last, read, leads, offers, candidates, jobs } = await fetchLeads(userbot, chat, cursors[key] ?? 0, { leads: leads_too, searches });
  // Из чата о работе сюда приходят только те, кто сам ищет работу; без адреса API отправлять некуда.
  if (env.API_URL && env.COLLECTOR_SECRET) for (const lead of leads) await toApi('lead', lead);
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
  const masters = await saveOffers({ store, extractOffer, resolve: (u) => resolveAuthor(userbot, u), pause: () => sleep(llmPauseMs), city_id }, offers);
  // Каждый проход — в журнал: иначе не отличить «вопросов нет» от «чат не читается».
  const vacancies = await saveJobs({ store, extractJob, pause: () => sleep(llmPauseMs), city: { id: city_id, name: city } }, jobs);
  console.log(`вопросы ${chat}: прочитано ${read}, похоже на «куда сходить» — ${leads.length}, мастеров ${masters} из ${offers.length}, находок ${found} из ${candidates.length}, вакансий ${vacancies} из ${jobs.length}`);
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
for (const [list, kind] of [[channels, 'announcements'], [chatList(env.LEAD_CHATS), 'leads'], [chatList(env.JOB_CHATS), 'jobs']]) {
  for (const s of await store.addSources(list, kind)) console.warn(`источник @${s.channel} — вид ${s.kind}, а в окружении он как ${kind}: поменяйте вид в админке («Источники»), если нужно`);
}

// Канал организатора — тоже источник: у него свои события. Каждый новый канал при первом чтении ищется по username
// (флудоопасно) и отдаёт до 100 публикаций в ИИ, поэтому добавляем по несколько за проход.
const ADOPT_PER_PASS = Number(env.ADOPT_PER_PASS ?? 5);

// Источник, события которого команда стабильно одобряет, модерацию пропускает (store.trustedChannels). 0 — выключено.
const AUTO_APPROVE_MIN = Number(env.AUTO_APPROVE_MIN ?? 5);

// Поиск источников для городов (source_searches): новому городу — в первый же проход, остальным — раз в
// SOURCE_SEARCH_DAYS дней (0 — только по просьбе команды). Канал, где за месяц SOURCE_AUTO_ADD_MIN и больше публикаций
// похожи на анонс, становится источником сам: его события всё равно идут через модерацию. Группы и остальное ждут
// команду в «Городах»: из чатов города уходят ответы людям, такое решает человек.
const SOURCE_SEARCH_DAYS = Number(env.SOURCE_SEARCH_DAYS ?? 30);
const SOURCE_AUTO_ADD_MIN = Number(env.SOURCE_AUTO_ADD_MIN ?? 3);
// ponytail: по одному слову на тему — 19 запросов на каждое написание города по 3 с, у Дананга с пятью написаниями
// поиск идёт минут 8 раз в месяц; шире — упрёмся в флуд-лимиты Telegram.
const CITY_WORDS = {
  '': [''], город: ['афиша', 'события', 'events', 'чат', 'chat', 'работа', 'jobs'],
  ...Object.fromEntries(Object.entries(TOPICS).map(([topic, words]) => [topic, words.slice(0, 1)])),
};

async function sourceSearch() {
  if (SOURCE_SEARCH_DAYS > 0) await store.queueSourceSearches(SOURCE_SEARCH_DAYS);
  const search = await store.takeSourceSearch();
  if (!search) return;
  try {
    const results = (await searchChannels(userbot, { names: search.names, local: cityMatcher(search.names), words: CITY_WORDS }))
      .map(({ topic, ...r }) => r);
    const strong = SOURCE_AUTO_ADD_MIN > 0 ? results.filter((r) => r.kind === 'announcements' && r.event_like >= SOURCE_AUTO_ADD_MIN) : [];
    const added = await store.addFoundSources(search.city_id, strong.map((r) => r.channel));
    await store.finishSourceSearch(search.id, { results });
    console.log(`поиск источников ${search.city_id}: найдено ${results.length}, в источники — ${added.map((c) => `@${c}`).join(', ') || 'никого'}`);
  } catch (e) {
    await store.finishSourceSearch(search.id, { error: e.message });
    throw e;
  }
}

async function pollChannel({ channel, host_username, city_id, city, timezone }, known, trusted) {
  const extract = extractFor({ city, timezone });
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
      const same = known.find((k) => k.city_id === city_id && isSameEvent(k.event, event));
      // Канал организатора в источники попал сам, без решения команды: событие, которое она уже проверила, он не меняет.
      const decided = same && same.status !== 'pending';
      if (decided && host_username) continue;
      // Событие без контакта не берём: записаться некуда. Появится контакт в другом посте — склеится или создастся там.
      if (!same && !event.telegram_username && !event.whatsapp_phone) continue;
      // Проверенному событию анонс из общего источника дописывает сведения, но не контакт для записи: иначе чужой пост
      // с похожим названием увёл бы «Записаться» к своему автору.
      const merged = !same ? event : decided
        ? { ...mergeEvents(same.event, event), telegram_username: same.event.telegram_username, whatsapp_phone: same.event.whatsapp_phone, url: same.event.url }
        : mergeEvents(same.event, event);
      if (same && JSON.stringify(merged) === JSON.stringify(same.event)) continue; // повтор без новых сведений
      // Дубль дополняет запись первого анонса, а не создаёт вторую.
      const external_id = same?.external_id ?? `telegram:${announcement.id}#${i}`;
      if (!same && bucket) media ??= await saveMedia(announcement, photos, album);
      const status = trusted.has(channel) ? 'approved' : 'pending'; // у известного события upsert статус не меняет
      await store.upsert({
        external_id, channel, city_id, announcement: media ? { ...announcement, media } : announcement, event: merged,
        signup_url: signupUrl(merged, announcement, signupMessage), status,
      });
      if (same) same.event = merged; else known.push({ external_id, city_id, event, status });
      if (!same && status === 'approved') console.log(`${external_id}: одобрено само — доверенный источник`);
    }
    // Сдвигаем отметку только после записи событий: упали посередине — повторим с этой же публикации.
    cursors[channel] = announcement.number;
    await store.saveCursor(channel, announcement.number);
    console.log(`${announcement.id}: ${candidate ? `событий ${events.length}` : 'отсеяно до ИИ'}`);
  }
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
  // Размер в ключе: файл другого размера — другой адрес, CDN не отдаст старую копию.
  const key = (f) => `telegram/${announcement.id.replace(/\/\d+$/, '')}/${f.number}_${f.width}x${f.height}.${f.ext}`;
  try {
    const media = [];
    for (const f of files) media.push({ type: f.type, url: await bucket.put(key(f), f.data, f.mime), width: f.width, height: f.height });
    return media;
  } catch (e) {
    console.error(`медиа ${announcement.id}: ${e.message}`);
    return null;
  }
}

do {
  // Темы — из базы; новая тема из накопившихся меток — не больше одной за проход.
  await syncTopics({ store }).catch((e) => console.error('темы:', e.message));
  if (env.TOPICS_AUTO !== '0') await curateTopics({ store, proposeTopic }).catch((e) => console.error('новая тема:', e.message));
  // Сбой дозаполнения (ИИ перегружен, лимит) не должен останавливать сбор: остаток доберём следующим проходом.
  await backfillTopics({ store, extract, pause: () => sleep(llmPauseMs) }).catch((e) => console.error('дозаполнение:', e.message));
  const adopted = await store.adoptHostChannels(ADOPT_PER_PASS).catch((e) => console.error('источники:', e.message));
  if (adopted?.length) console.log(`новые источники от организаторов: ${adopted.map((c) => `@${c}`).join(', ')}`);
  const known = await store.upcoming();
  cursors = await store.cursors();
  const trusted = new Set(AUTO_APPROVE_MIN > 0 ? await store.trustedChannels(AUTO_APPROVE_MIN) : []);
  for (const source of await store.sources()) {
    await pollChannel(source, known, trusted).catch((e) => failed(source.channel, source.channel, e));
    await sleep(2000); // не частим с запросами к Telegram
  }
  await savePeers().catch((e) => console.error(`каналы: ${e.message}`));
  await sourceSearch().catch((e) => console.error(`поиск источников: ${e.message}`));
  const chats = await store.chats();
  const searches = chats.some((c) => c.leads) ? await activeSearches().catch((e) => (console.error(`запросы организаторов: ${e.message}`), [])) : [];
  // Вопросы уходят в API: без его адреса из чатов берём только вакансии.
  for (const chat of chats) {
    await pollLeads(chat, Boolean(chat.leads && env.API_URL && env.COLLECTOR_SECRET), searches).catch((e) => failed(chat.chat, `вопросы ${chat.chat}`, e));
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
