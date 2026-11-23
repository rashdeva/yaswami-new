// Вакансии из истории чатов: npm run backfill-jobs [чат …]. Разовый запуск руками: сборщик сам видит только новые
// сообщения, а этот скрипт проходит назад на SCOUT_DAYS дней (по умолчанию 30) по JOB_CHATS и LEAD_CHATS или чатам
// из аргументов. Пишет в jobs через тот же saveJobs, что и сборщик. Сессия — SCOUT_SESSION: сессию сборщика рядом с Railway не открываем.
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_CITY_ID } from '@yaswami/core';
import { createJobExtractor } from '@yaswami/extract';
import { connect } from './mtproto.mjs';
import { pickJobs, saveJobs } from './jobs.mjs';
import { chatsToPoll } from './lead.mjs';
import { createStore } from './store.mjs';

const { TG_API_ID, TG_API_HASH, SCOUT_SESSION, DATABASE_URL, JOB_CHATS = '', LEAD_CHATS = '', GEMINI_API_KEY } = process.env;
if (!SCOUT_SESSION || !DATABASE_URL || !GEMINI_API_KEY) throw new Error('Нужны SCOUT_SESSION, DATABASE_URL и GEMINI_API_KEY');
const days = Number(process.env.SCOUT_DAYS ?? 30);
const args = process.argv.slice(2).filter((a) => a !== '--');
const list = (value) => value.split(',').map((c) => c.trim().replace(/^@/, '')).filter(Boolean);
const chats = args.length ? args : chatsToPoll(list(LEAD_CHATS), list(JOB_CHATS)).map((c) => c.chat);

const client = connect({ apiId: TG_API_ID, apiHash: TG_API_HASH, session: SCOUT_SESSION });
await client.connect();
const store = createStore(DATABASE_URL);
const extractJob = createJobExtractor({ model: process.env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite' });
const pause = () => sleep(Number(process.env.LLM_PAUSE_MS ?? 4500));
// ponytail: город по умолчанию, как в main.mjs.
const city = { id: DEFAULT_CITY_ID, name: process.env.CITY ?? 'Дананг' };
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
  // От старых к новым: повтор объявления сдвигает posted_at первой строки вперёд.
  const jobs = pickJobs(chat, messages.reverse());
  const saved = await saveJobs({ store, extractJob, pause, city }, jobs);
  total += saved;
  console.log(`@${chat}: ${messages.length} сообщений, похоже на вакансии ${jobs.length}, новых вакансий ${saved}`);
  await sleep(1500);
}
console.log(`всего новых вакансий: ${total}`);
await client.disconnect();
await store.end();
process.exit(0); // GramJS держит таймеры и сам не отпускает процесс
