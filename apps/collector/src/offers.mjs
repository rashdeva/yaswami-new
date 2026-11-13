// Мастера и ведущие, которые сами рассказывают в чатах, что проводят: «Я Светлана, тренер-реабилитолог, записывайтесь».
// Дешёвый отбор без ИИ здесь; что именно человек ведёт (Practice), извлекает ИИ (packages/extract, offer.ts).
// Найденное ложится в hosts: так в каталоге организаторов появляются те, у кого нет событий с датой.

// ponytail: наивный список слов самопредставления; расширять по тому, что реально пишут мастера.
const SIGNS = [
  /(?<![а-яё])(провожу|веду|преподаю|обучаю|принимаю)(?![а-яё])/i,
  /записывайтесь|запись\s+(открыта|в\s+лс|в\s+личк|по\s+ссылк)|пишите\s+в\s+(лс|личк)/i,
  /индивидуальн|групповые\s+(занятия|тренировки|уроки)|мастер[- ]класс|пробное\s+занятие/i,
  /(?<![а-яё])(массаж|тренер|инструктор|преподавател|репетитор|коуч|мастер\s+по)/i,
  /меня\s+зовут|я\s*[—–-]?\s*(тренер|мастер|преподаватель|инструктор|массажист|психолог)|опыт\s+(более\s+)?\d+|\d+\+?\s+(лет|года)\s+опыта/i,
  /стоимость|цена|\d+\s?(k|к|000)\s?(vnd|донг)?(?![а-яёa-z])/i,
];

/** Похоже ли сообщение на самопредставление мастера: длинное и хотя бы два разных признака. */
export const looksLikeOffer = (text) => text.length >= 120 && text.length <= 3000 && SIGNS.filter((re) => re.test(text)).length >= 2;

const NOT_PEOPLE = new Set(['joinchat', 'c', 's', 'addlist', 'share', 'proxy', 'iv']);

/** @username и t.me/… из текста, в нижнем регистре, без повторов; ботов и служебных ссылок нет. */
export const contactsIn = (text) => [...new Set(
  [...text.matchAll(/(?:t\.me\/|@)([a-z][a-z0-9_]{3,31})/gi)].map((m) => m[1].toLowerCase()).filter((u) => !NOT_PEOPLE.has(u) && !/bot$/.test(u)),
)];

/**
 * Самопредставления среди сообщений чата, одно — последнее — на человека.
 * Автор — человек с username (иначе ему не написать). В больших чатах реклама идёт через бота чата: тогда автор неизвестен,
 * а мастер — первый контакт из текста (`author.id` пустой, его находит saveOffers).
 */
export function pickOffers(chat, messages) {
  const byAuthor = new Map();
  for (const m of messages) {
    const s = m.sender;
    if (!m.message || !looksLikeOffer(m.message)) continue;
    const person = s?.className === 'User' && !s.bot && s.username;
    const username = person ? s.username.toLowerCase() : contactsIn(m.message).find((u) => u !== chat.toLowerCase());
    if (!username) continue;
    byAuthor.set(username, {
      url: `https://t.me/${chat}/${m.id}`,
      author: person
        ? { id: Number(s.id), name: [s.firstName, s.lastName].filter(Boolean).join(' ') || s.username, username }
        : { id: null, name: null, username },
      text: m.message,
    });
  }
  return [...byAuthor.values()];
}

// FLOOD_WAIT пробрасываем — пусть повторится позже; «нет такого username» — не мастер.
const orNull = (e) => { if (e.seconds) throw e; return null; };

/** Кто стоит за username из рекламы: человек или канал (студия). Бот, группа, никого — null. */
export async function resolveAuthor(client, username) {
  const e = await client.getEntity(username).catch(orNull);
  if (e?.className === 'User' && !e.bot) return { id: Number(e.id), name: [e.firstName, e.lastName].filter(Boolean).join(' ') || username };
  // У каналов и людей разные нумерации: каналу id вида -100…, как в host.mjs.
  if (e?.className === 'Channel' && e.broadcast) return { id: Number(`-100${e.id}`), name: e.title };
  return null;
}

/**
 * Разобрать самопредставления ИИ и сохранить мастеров. `resolve(username)` — кто это в Telegram (resolveAuthor).
 * У кого Practice уже есть, пропускаем: мастера повторяют
 * рекламу каждый день, а запросы к ИИ ограничены. ponytail: Practice не обновляются; обновлять, если мастера жалуются.
 */
export async function saveOffers({ store, extractOffer, resolve, pause }, offers) {
  let saved = 0;
  for (const { url, author, text } of offers) {
    if (await store.hasPractices(author.id ?? author.username)) continue;
    try {
      const offer = await extractOffer(author.name ?? `@${author.username}`, text);
      // Автор неизвестен (реклама через бота) — ищем мастера по username только для настоящих предложений: поиск флудоопасен.
      const who = offer && (author.id ? author : await resolve(author.username).then((r) => r && { ...author, ...r }));
      if (who) {
        await store.saveOffer({ telegram_id: who.id, username: who.username, name: who.name, summary: offer.summary || null, practices: offer.practices });
        saved++;
        console.log(`мастер @${author.username}: ${offer.practices.map((p) => p.title).join(', ')} (${url})`);
      }
    } catch (e) {
      console.error(`мастер @${author.username}: ${e.status ?? ''} ${e.message.slice(0, 120)}`); // лимит ИИ и прочее: это объявление пропустим
    }
    await pause();
  }
  return saved;
}
