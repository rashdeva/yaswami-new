import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { createExtractor, isSameEvent, looksLikeEvent, mergeEvents } from '@yaswami/extract';
import { signupUrl } from './signup.mjs';
import { connect, fetchChatAnnouncements } from './mtproto.mjs';
import { createStore } from './store.mjs';

const env = process.env;
const channels = (env.CHANNELS ?? '').split(',').map((c) => c.trim().replace(/^@/, '')).filter(Boolean);
if (!channels.length) throw new Error('CHANNELS пуст: укажи каналы и группы через запятую');
if (!env.TG_SESSION) throw new Error('TG_SESSION пуст: выполни pnpm --filter @yaswami/collector login');
if (!env.DATABASE_URL) throw new Error('DATABASE_URL пуст');
const userbot = connect({ apiId: env.TG_API_ID, apiHash: env.TG_API_HASH, session: env.TG_SESSION });
const store = createStore(env.DATABASE_URL);
const llmPauseMs = Number(env.LLM_PAUSE_MS ?? 4500); // ≈13 запросов в минуту при лимите 15
const maxAgeMs = Number(env.MAX_AGE_DAYS ?? 14) * 86_400_000; // старые публикации в ИИ не отправляем
const pollMinutes = Number(env.POLL_MINUTES ?? 15);
const signupMessage = env.SIGNUP_MESSAGE ?? 'Привет! Я нашёл событие «{title}» на Ясвами, хочу записаться.';
const extract = createExtractor({
  model: env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite',
  city: env.CITY ?? 'Дананг',
  timezone: env.TIMEZONE ?? 'Asia/Ho_Chi_Minh',
});

const cursors = await store.cursors();
// Railway проверяет /health при деплое (общий railway.json); отвечаем, когда БД уже доступна.
if (env.PORT) createServer((_, res) => res.end('ok')).listen(env.PORT);

async function pollChannel(channel, known) {
  const fresh = (await fetchChatAnnouncements(userbot, channel, cursors[channel] ?? 0))
    .sort((a, b) => a.number - b.number);
  for (const announcement of fresh) {
    const candidate = Date.now() - new Date(announcement.published_at) < maxAgeMs && looksLikeEvent(announcement.text);
    const events = candidate ? await extract(announcement) : [];
    if (candidate) await sleep(llmPauseMs); // бесплатный уровень Gemini считает запросы в минуту
    for (const [i, event] of events.entries()) {
      if (new Date(event.ends_at ?? event.starts_at) < Date.now()) continue; // уже прошло
      const same = known.find((k) => isSameEvent(k.event, event));
      const merged = same ? mergeEvents(same.event, event) : event;
      if (same && JSON.stringify(merged) === JSON.stringify(same.event)) continue; // повтор без новых сведений
      // Дубль дополняет запись первого анонса, а не создаёт вторую.
      const external_id = same?.external_id ?? `telegram:${announcement.id}#${i}`;
      await store.upsert({
        external_id, channel, announcement, event: merged,
        signup_url: signupUrl(merged, announcement, signupMessage),
      });
      if (same) same.event = merged; else known.push({ external_id, event });
    }
    // Сдвигаем отметку только после записи событий: упали посередине — повторим с этой же публикации.
    cursors[channel] = announcement.number;
    await store.saveCursor(channel, announcement.number);
    console.log(`${announcement.id}: ${candidate ? `событий ${events.length}` : 'отсеяно до ИИ'}`);
  }
}

do {
  const known = await store.upcoming();
  for (const channel of channels) {
    await pollChannel(channel, known).catch((e) => console.error(`${channel}: ${e.message}`));
    await sleep(2000); // не частим с запросами к Telegram
  }
  if (pollMinutes) await sleep(pollMinutes * 60_000);
} while (pollMinutes);
await userbot.disconnect();
await store.end();
process.exit(0); // GramJS держит таймеры и сам не отпускает процесс
