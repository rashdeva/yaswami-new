// Люди из истории чатов — в охотника: npm run backfill-leads [чат …]. Разовый запуск руками: сборщик сам видит только новые
// сообщения, а этот скрипт проходит назад на SCOUT_DAYS дней (по умолчанию 7) по LEAD_CHATS или чатам из аргументов
// и отправляет найденных в API (`POST /internal/lead`). Старое сообщение API превращает в черновик в личку — в «Ждут вас».
// Одному человеку — одно сообщение (лучший сигнал), не больше LEADS_LIMIT (по умолчанию 60): каждый черновик потом читает
// и отправляет человек. Писали за неделю — API пропустит сам. Сессия — SCOUT_SESSION: сессию сборщика рядом с Railway не открываем.
import { setTimeout as sleep } from 'node:timers/promises';
import { connect } from './mtproto.mjs';
import { pickLeads } from './lead.mjs';

const { TG_API_ID, TG_API_HASH, SCOUT_SESSION, API_URL, COLLECTOR_SECRET, LEAD_CHATS = '' } = process.env;
if (!SCOUT_SESSION || !API_URL || !COLLECTOR_SECRET) throw new Error('Нужны SCOUT_SESSION, API_URL и COLLECTOR_SECRET');
const days = Number(process.env.SCOUT_DAYS ?? 7);
const limit = Number(process.env.LEADS_LIMIT ?? 60);
const pauseMs = Number(process.env.LEADS_PAUSE_MS ?? 20_000); // роль отвечает в фоне; не держим десятки её запросов сразу
const args = process.argv.slice(2).filter((a) => a !== '--');
const chats = args.length ? args : LEAD_CHATS.split(',').map((c) => c.trim()).filter(Boolean);

const WEIGHT = { seek: 3, ask: 2, newcomer: 1 };
const client = connect({ apiId: TG_API_ID, apiHash: TG_API_HASH, session: SCOUT_SESSION });
await client.connect();
const since = Date.now() / 1000 - days * 86400;

const best = new Map(); // автор → лучший сигнал из всех чатов; при равенстве — свежее
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
  const leads = pickLeads(chat, messages.reverse(), Date.now(), days * 86_400_000);
  for (const l of leads) {
    const prev = best.get(l.author.id);
    if (!prev || WEIGHT[l.signal] > WEIGHT[prev.signal] || (WEIGHT[l.signal] === WEIGHT[prev.signal] && l.sent_at > prev.sent_at)) best.set(l.author.id, l);
  }
  console.log(`@${chat}: ${messages.length} сообщений, людей с интересом ${leads.length}`);
  await sleep(1500);
}
await client.disconnect();

// Теплее и свежее — первыми: если лимит кончится, останутся самые слабые.
const queue = [...best.values()].sort((a, b) => WEIGHT[b.signal] - WEIGHT[a.signal] || b.sent_at.localeCompare(a.sent_at)).slice(0, limit);
console.log(`в охотника: ${queue.length} из ${best.size}`);
for (const [i, lead] of queue.entries()) {
  const res = await fetch(`${API_URL}/internal/lead`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-collector-secret': COLLECTOR_SECRET },
    body: JSON.stringify(lead), signal: AbortSignal.timeout(15_000),
  }).catch((e) => ({ ok: false, status: e.message }));
  console.log(`${i + 1}/${queue.length} ${lead.signal} ${lead.url} — ${res.ok ? 'принято' : `ошибка ${res.status}`}`);
  if (i < queue.length - 1) await sleep(pauseMs);
}
process.exit(0);
