// Разведка для охотника: npm run scout [запрос1 запрос2 …]. Разовый запуск руками, в проде не работает, ничего не пишет.
// 1. Ищет публичные группы по названию города (CITY_ID и CITY_ALIASES, как у find-sources.mjs), берёт чаты города с kind leads
//    и обсуждения при каналах-источниках города (там отвечают на анонсы).
// 2. Читает их историю за SCOUT_DAYS дней (по умолчанию 30).
// 3. Показывает, где живое общение, и людей, проявивших интерес к досугу, с баллом: кому писать первым.
// Сессия — SCOUT_SESSION, отдельный аккаунт: сессию сборщика (TG_SESSION) нельзя открывать рядом с Railway.
import { setTimeout as sleep } from 'node:timers/promises';
import telegram from 'telegram';
import { connect } from './mtproto.mjs';
import { signalOf, TOPIC } from './lead.mjs';
import { scoutCity } from './city.mjs';
import { createStore } from './store.mjs';

const MAX_PER_CHAT = 5000; // ponytail: болтливый чат обрезается; если важен — искать в нём по словам (messages.Search)

const WEIGHT = { seek: 3, ask: 2, newcomer: 1 }; // «ищу партнёра на бачату» теплее вопроса «куда сходить», а тот — «только приехал»
const signalWeight = (text) => WEIGHT[signalOf(text)] ?? 0;

/**
 * Люди с интересом к досугу среди сообщений чата за `days` дней до `now`, по одному на человека, лучшие первыми.
 * Балл = сигнал × свежесть (до 3 дней ×3, до 2 недель ×2, старше ×1) + 1 за каждое ещё одно такое сообщение.
 */
export function pickCandidates(chat, messages, days, now = Date.now()) {
  const since = now / 1000 - days * 86400;
  const byAuthor = new Map();
  for (const m of messages) {
    const s = m.sender;
    if (!m.message || m.date < since || s?.className !== 'User' || s.bot || m.message.length > 500) continue;
    const signal = signalWeight(m.message);
    if (!signal) continue;
    const age = (now / 1000 - m.date) / 86400;
    const score = signal * (age <= 3 ? 3 : age <= 14 ? 2 : 1);
    const key = String(s.id);
    const prev = byAuthor.get(key);
    if (prev && prev.score >= score) { prev.repeats++; continue; }
    byAuthor.set(key, {
      score, repeats: prev ? prev.repeats + 1 : 0, chat, url: `https://t.me/${chat}/${m.id}`,
      date: new Date(m.date * 1000).toISOString().slice(0, 10),
      author: { id: Number(s.id), name: [s.firstName, s.lastName].filter(Boolean).join(' '), username: s.username ?? null },
      topic: m.message.match(TOPIC)?.[1]?.toLowerCase() ?? null,
      text: m.message.replace(/\s+/g, ' '),
    });
  }
  return [...byAuthor.values()].map((c) => ({ ...c, score: c.score + c.repeats })).sort((a, b) => b.score - a.score);
}

/** Сводка по сообщениям чата за `days` дней до `now`. */
export function chatStats(messages, days, now = Date.now()) {
  const since = now / 1000 - days * 86400;
  const fresh = messages.filter((m) => m.date >= since && m.message);
  const people = fresh.filter((m) => m.sender?.className === 'User' && !m.sender.bot);
  return { per_day: Math.round(fresh.length / days), authors: new Set(people.map((m) => String(m.sender.id))).size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { TG_API_ID, TG_API_HASH, SCOUT_SESSION, DATABASE_URL } = process.env;
  if (!SCOUT_SESSION || !DATABASE_URL) throw new Error('Нужны SCOUT_SESSION (войди запасным аккаунтом — npm run login SCOUT_SESSION) и DATABASE_URL');
  const days = Number(process.env.SCOUT_DAYS ?? 30);
  const args = process.argv.slice(2).filter((a) => a !== '--'); // pnpm пробрасывает «--» как аргумент
  const store = createStore(DATABASE_URL);
  const city = await scoutCity(store);
  const queries = args.length ? args
    : city.names.flatMap((n) => [n, ...['чат', 'барахолка', 'девушки', 'работа', 'дети', 'спорт', 'танцы'].map((w) => `${n} ${w}`)]);

  const client = connect({ apiId: TG_API_ID, apiHash: TG_API_HASH, session: SCOUT_SESSION });
  await client.connect();
  const groups = new Map(); // username → [чат, откуда узнали]
  const add = (c, from) => c?.username && !groups.has(c.username.toLowerCase()) && groups.set(c.username.toLowerCase(), [c, from]);

  for (const q of queries) {
    const found = await client.invoke(new telegram.Api.contacts.Search({ q, limit: 100 }));
    for (const c of found.chats) if (c.megagroup) add(c, 'поиск');
    await sleep(1500);
  }
  for (const { chat } of (await store.chats()).filter((c) => c.leads && c.city_id === city.id)) {
    add(await client.getEntity(chat).catch(() => null), 'чат города');
  }
  // Обсуждения при каналах-источниках города: там отвечают на анонсы — самые тёплые люди.
  for (const { channel } of (await store.sources()).filter((s) => s.city_id === city.id)) {
    if (/^-?\d+$/.test(channel)) continue; // закрытый — только по приглашению
    try {
      const full = await client.invoke(new telegram.Api.channels.GetFullChannel({ channel }));
      const linked = full.chats.find((c) => String(c.id) === String(full.fullChat.linkedChatId));
      add(linked, `обсуждение @${channel}`);
    } catch (e) { console.error(`@${channel}: ${e.message}`); }
    await sleep(1500);
  }
  await store.end();
  console.log(`групп: ${groups.size}, читаем историю за ${days} дн.`);

  const rows = [];
  const candidates = new Map(); // один человек — одна строка, лучший сигнал из всех чатов
  for (const [chat, from] of groups.values()) {
    const since = Date.now() / 1000 - days * 86400;
    const messages = [];
    try {
      for await (const m of client.iterMessages(chat, { limit: MAX_PER_CHAT, waitTime: 1 })) { // 1 с между страницами по 100: меньше FLOOD_WAIT
        if (m.date < since) break;
        messages.push(m);
      }
    } catch (e) {
      console.error(`@${chat.username}: ${e.message}`);
      continue;
    }
    const found = pickCandidates(chat.username, messages, days);
    for (const c of found) if ((candidates.get(c.author.id)?.score ?? -1) < c.score) candidates.set(c.author.id, c);
    rows.push({ chat: `@${chat.username}`, from, title: chat.title.slice(0, 35), members: chat.participantsCount ?? null, ...chatStats(messages, days), people: found.length });
    console.log(`@${chat.username}: ${messages.length} сообщений, людей с интересом ${found.length}`);
    await sleep(1500); // не частим: флуд-бан мешает разведке
  }

  console.table(rows.sort((a, b) => b.per_day - a.per_day));
  const top = [...candidates.values()].sort((a, b) => b.score - a.score);
  console.log(`\nЛюди с интересом (${top.length}), лучшие первыми. Без username написать с нашего аккаунта не выйдет.`);
  for (const c of top) {
    console.log(`${c.score}\t${c.date}\t${c.author.username ? `@${c.author.username}` : `(${c.author.name})`}\t${c.topic ?? '—'}\t${c.url}\n\t${c.text.slice(0, 200)}`);
  }
  await client.disconnect();
  process.exit(0);
}
