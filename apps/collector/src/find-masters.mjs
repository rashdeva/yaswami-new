// Мастера из истории чатов: npm run find-masters [чат …]. Разовый запуск руками: сборщик сам смотрит только новые сообщения
// (pollLeads), а этот скрипт проходит назад на SCOUT_DAYS дней (по умолчанию 30) по LEAD_CHATS или чатам из аргументов.
// Пишет в hosts через тот же saveOffers, что и сборщик. Сессия — SCOUT_SESSION: сессию сборщика рядом с Railway не открываем.
import { setTimeout as sleep } from 'node:timers/promises';
import { createOfferExtractor } from '@yaswami/extract';
import { connect } from './mtproto.mjs';
import { pickOffers, resolveAuthor, saveOffers } from './offers.mjs';
import { createStore } from './store.mjs';

const { TG_API_ID, TG_API_HASH, SCOUT_SESSION, DATABASE_URL, LEAD_CHATS = '', GEMINI_API_KEY } = process.env;
if (!SCOUT_SESSION || !DATABASE_URL || !GEMINI_API_KEY) throw new Error('Нужны SCOUT_SESSION, DATABASE_URL и GEMINI_API_KEY');
const days = Number(process.env.SCOUT_DAYS ?? 30);
const args = process.argv.slice(2).filter((a) => a !== '--');
const chats = args.length ? args : LEAD_CHATS.split(',').map((c) => c.trim()).filter(Boolean);

const client = connect({ apiId: TG_API_ID, apiHash: TG_API_HASH, session: SCOUT_SESSION });
await client.connect();
const store = createStore(DATABASE_URL);
const extractOffer = createOfferExtractor({ model: process.env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite' });
const pause = () => sleep(Number(process.env.LLM_PAUSE_MS ?? 4500));
const since = Date.now() / 1000 - days * 86400;

let total = 0;
for (const chat of chats) {
  const messages = [];
  try {
    for await (const m of client.iterMessages(chat, { limit: 5000, waitTime: 1 })) {
      if (m.date < since) break;
      messages.push(m);
    }
  } catch (e) {
    console.error(`@${chat}: ${e.message}`);
    continue;
  }
  const offers = pickOffers(chat, messages.reverse());
  const saved = await saveOffers({ store, extractOffer, resolve: (u) => resolveAuthor(client, u), pause }, offers);
  total += saved;
  console.log(`@${chat}: ${messages.length} сообщений, похоже на мастеров ${offers.length}, сохранено ${saved}`);
  await sleep(1500);
}
console.log(`всего мастеров: ${total}`);
await client.disconnect();
await store.end();
process.exit(0);
