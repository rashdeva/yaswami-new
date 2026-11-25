// Поиск источников по темам, которые ищут люди: npm run find-sources [тема …]. Разовый запуск руками, ничего не пишет.
// Город — CITY_ID (по умолчанию первый) из таблицы cities; CITY_ALIASES — другие его написания через запятую
// («Danang,Da Nang,Hoi An»): по ним тоже ищем, и по ним узнаём, что канал про этот город.
// 1. Каналы и группы по названию: «<город> футбол»… — сколько публикаций за месяц и сколько похожи на анонс.
// 2. Инструкторы и организаторы: в живых чатах (SCOUT_CHATS, по умолчанию — чаты города с kind leads) ищет сообщения
//    по словам темы и собирает из них @username и t.me-ссылки — так находятся те, кого советуют и кто сам себя рекламирует.
// Источник добавляет человек — в админке («Источники»). Сессия — SCOUT_SESSION, как у scout.mjs.
// Поиск по названию города (searchChannels) сборщик делает и сам, в фоне: sourceSearch в main.mjs.
import { setTimeout as sleep } from 'node:timers/promises';
import telegram from 'telegram';
import { looksLikeEvent } from '@yaswami/extract';
import { connect } from './mtproto.mjs';
import { scoutCity } from './city.mjs';
import { contactsIn } from './offers.mjs';
import { createStore } from './store.mjs';

export { contactsIn };

export const TOPICS = {
  футбол: ['футбол', 'football'], мафия: ['мафия', 'mafia'], сёрф: ['серф', 'сёрф', 'surf'],
  теннис: ['теннис', 'tennis', 'падел', 'padel'], баскетбол: ['баскетбол', 'basketball'], волейбол: ['волейбол', 'volleyball'],
  танцы: ['танцы', 'бачата', 'сальса', 'кизомба', 'hip hop', 'dance'], йога: ['йога', 'пилатес', 'yoga', 'pilates'],
  настолки: ['настолки', 'настольные игры', 'board games'], бег: ['бег', 'running'], квиз: ['квиз', 'quiz'],
};
/** Каким источником вероятнее всего будет найденный чат: группа — чат города, канал — анонсы. */
export const suggestKind = ({ megagroup }) => (megagroup ? 'leads' : 'announcements');

/**
 * Каналы и группы города по запросам «<название> <слово>» (`words` — { тема: [слова] }, слово '' — само название):
 * только те, где в названии или username есть город (`local`). Для каждого — сколько публикаций за 30 дней среди
 * последних 50 и сколько из них похожи на анонс. Лучшие первыми. Смотрим не больше `limit` чатов.
 */
export async function searchChannels(client, { names, local, words, limit = 80 }) {
  const since = Date.now() / 1000 - 30 * 86400;
  const found = new Map(); // username → { chat, topic }
  for (const [topic, list] of Object.entries(words)) {
    for (const q of list.flatMap((w) => names.map((n) => `${n} ${w}`.trim()))) {
      const res = await client.invoke(new telegram.Api.contacts.Search({ q, limit: 50 }));
      for (const c of res.chats) {
        if (c.username && local.test(`${c.title} ${c.username}`) && !found.has(c.username.toLowerCase())) found.set(c.username.toLowerCase(), { chat: c, topic });
      }
      await sleep(3000); // contacts.Search — самый флудоопасный вызов
    }
  }
  const rows = [];
  for (const { chat, topic } of [...found.values()].slice(0, limit)) {
    try {
      const posts = (await client.getMessages(chat, { limit: 50 })).filter((m) => m.date >= since && m.message);
      rows.push({
        channel: chat.username, title: chat.title, group: Boolean(chat.megagroup), members: chat.participantsCount ?? null,
        posts_30d: posts.length, event_like: posts.filter((m) => looksLikeEvent(m.message)).length, kind: suggestKind(chat), topic,
      });
    } catch (e) { console.error(`@${chat.username}: ${e.message}`); }
    await sleep(2000);
  }
  return rows.sort((a, b) => b.event_like - a.event_like || b.posts_30d - a.posts_30d);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { TG_API_ID, TG_API_HASH, SCOUT_SESSION, DATABASE_URL } = process.env;
  if (!SCOUT_SESSION || !DATABASE_URL) throw new Error('Нужны SCOUT_SESSION (npm run login SCOUT_SESSION) и DATABASE_URL');
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const topics = args.length ? Object.fromEntries(args.map((t) => [t, TOPICS[t] ?? [t]])) : TOPICS;
  const store = createStore(DATABASE_URL);
  const city = await scoutCity(store);
  const chats = process.env.SCOUT_CHATS?.split(',') ?? (await store.chats()).filter((c) => c.city_id === city.id).map((c) => c.chat);
  const known = await store.knownChannels();
  await store.end();

  const client = connect({ apiId: TG_API_ID, apiHash: TG_API_HASH, session: SCOUT_SESSION });
  await client.connect();
  const since90 = Date.now() / 1000 - 90 * 86400;

  // 1. Каналы и группы по темам.
  const rows = await searchChannels(client, { names: city.names, local: city.local, words: topics, limit: Infinity });
  console.log(`каналов и групп по темам: ${rows.length}`);
  console.table(rows.map((r) => ({
    chat: `@${r.channel}`, topic: r.topic, kind: r.group ? 'группа' : 'канал', title: r.title.slice(0, 35),
    members: r.members, posts_30d: r.posts_30d, event_like: r.event_like, source: known.get(r.channel.toLowerCase()) ?? '',
  })));

  // 2. Кого упоминают рядом со словами темы в живых чатах.
  const mentions = new Map(); // username → { count, topics, sample }
  for (const chat of chats) {
    for (const [topic, words] of Object.entries(topics)) {
      for (const w of words.slice(0, 2)) { // ponytail: два слова на тему — поиск по чату флудоопасен
        try {
          const msgs = await client.getMessages(chat, { search: w, limit: 50 });
          for (const m of msgs) {
            if (!m.message || m.date < since90) continue;
            for (const u of contactsIn(m.message)) {
              const x = mentions.get(u) ?? { count: 0, topics: new Set(), sample: `https://t.me/${chat}/${m.id}  ${m.message.replace(/\s+/g, ' ').slice(0, 140)}` };
              x.count++; x.topics.add(topic); mentions.set(u, x);
            }
          }
        } catch (e) { console.error(`@${chat} «${w}»: ${e.message}`); }
        await sleep(3000);
      }
    }
    console.log(`@${chat}: упоминаний пока ${mentions.size}`);
  }
  console.log('\nУпоминают рядом со словами темы (за 90 дней):');
  for (const [u, x] of [...mentions].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`${x.count}\t@${u}\t${[...x.topics].join(',')}\t${known.get(u) ?? ''}\n\t${x.sample}`);
  }
  await client.disconnect();
  process.exit(0);
}
