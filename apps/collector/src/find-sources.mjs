// Поиск источников по темам, которые ищут люди: npm run find-sources [тема …]. Разовый запуск руками, ничего не пишет.
// 1. Каналы и группы по названию: «Дананг футбол», «Danang surf»… — сколько публикаций за месяц и сколько похожи на анонс.
// 2. Инструкторы и организаторы: в живых чатах (SCOUT_CHATS) ищет сообщения по словам темы и собирает из них
//    @username и t.me-ссылки — так находятся те, кого советуют и кто сам себя рекламирует.
// Источник добавляет человек — в админке («Источники»). Сессия — SCOUT_SESSION, как у scout.mjs.
import { setTimeout as sleep } from 'node:timers/promises';
import telegram from 'telegram';
import postgres from 'postgres';
import { looksLikeEvent } from '@yaswami/extract';
import { connect } from './mtproto.mjs';
import { contactsIn } from './offers.mjs';

export { contactsIn };

const TOPICS = {
  футбол: ['футбол', 'football'], мафия: ['мафия', 'mafia'], сёрф: ['серф', 'сёрф', 'surf'],
  теннис: ['теннис', 'tennis', 'падел', 'padel'], баскетбол: ['баскетбол', 'basketball'], волейбол: ['волейбол', 'volleyball'],
  танцы: ['танцы', 'бачата', 'сальса', 'кизомба', 'hip hop', 'dance'], йога: ['йога', 'пилатес', 'yoga', 'pilates'],
  настолки: ['настолки', 'настольные игры', 'board games'], бег: ['бег', 'running'], квиз: ['квиз', 'quiz'],
};
const LOCAL = /данан|danang|da\s?nang|хойан|hoi\s?an|вьетнам|vietnam|vn\b/i;
if (import.meta.url === `file://${process.argv[1]}`) {
  const { TG_API_ID, TG_API_HASH, SCOUT_SESSION, DATABASE_URL } = process.env;
  if (!SCOUT_SESSION) throw new Error('SCOUT_SESSION пуст: npm run login SCOUT_SESSION');
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const topics = args.length ? Object.fromEntries(args.map((t) => [t, TOPICS[t] ?? [t]])) : TOPICS;
  const chats = (process.env.SCOUT_CHATS ?? 'danang_women,danangchat_ask,Danang_Viet,DaNang_girls,DanangKids,da_nang_chat').split(',');

  const known = new Map();
  if (DATABASE_URL) {
    const sql = postgres(DATABASE_URL, { onnotice: () => {} });
    for (const s of await sql`select channel, enabled from sources`) known.set(s.channel.toLowerCase(), s.enabled ? 'есть' : 'выключен');
    for (const h of await sql`select lower(username) u from hosts where username is not null`) if (!known.has(h.u)) known.set(h.u, 'организатор');
    await sql.end();
  }

  const client = connect({ apiId: TG_API_ID, apiHash: TG_API_HASH, session: SCOUT_SESSION });
  await client.connect();
  const since = Date.now() / 1000 - 30 * 86400;
  const since90 = Date.now() / 1000 - 90 * 86400;

  // 1. Каналы и группы по темам.
  const found = new Map(); // username → { chat, topic }
  for (const [topic, words] of Object.entries(topics)) {
    for (const q of words.flatMap((w) => [`Дананг ${w}`, `Danang ${w}`])) {
      const res = await client.invoke(new telegram.Api.contacts.Search({ q, limit: 50 }));
      for (const c of res.chats) {
        if (c.username && LOCAL.test(`${c.title} ${c.username}`) && !found.has(c.username.toLowerCase())) found.set(c.username.toLowerCase(), { chat: c, topic });
      }
      await sleep(3000); // contacts.Search — самый флудоопасный вызов
    }
  }
  console.log(`каналов и групп по темам: ${found.size}`);
  const rows = [];
  for (const { chat, topic } of found.values()) {
    try {
      const posts = (await client.getMessages(chat, { limit: 50 })).filter((m) => m.date >= since && m.message);
      rows.push({
        chat: `@${chat.username}`, topic, kind: chat.megagroup ? 'группа' : 'канал', title: chat.title.slice(0, 35),
        members: chat.participantsCount ?? null, posts_30d: posts.length, event_like: posts.filter((m) => looksLikeEvent(m.message)).length,
        source: known.get(chat.username.toLowerCase()) ?? '',
      });
    } catch (e) { console.error(`@${chat.username}: ${e.message}`); }
    await sleep(2000);
  }
  console.table(rows.sort((a, b) => b.event_like - a.event_like || b.posts_30d - a.posts_30d));

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
