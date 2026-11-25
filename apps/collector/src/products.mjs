// Товары мастеров (Product) из источников вида products: канал мастера (у источника указан Host) или группа объявлений
// вроде ads_danang. Дешёвый отбор без ИИ здесь; что за товары и продаёт ли автор своё, решает ИИ (packages/extract,
// product.ts). Мастер — Host: кого ещё нет, создаём, как мастера из самопредставления (offers.mjs).
// Признаки — из разведки, раздел «Мастер или перепродажа»: docs/research/makers-market-danang.md.
import { productTitleKey } from '@yaswami/core';
import { contactsIn } from './offers.mjs';

// ponytail: наивные списки слов; расширять по тому, что реально пишут мастера и продавцы барахолки.
const MAKER = [
  // цена в донгах: «55к», «250 000 ₫», «120k», «/кг»
  /\d\s?(к|k|тыс\.?)(?![а-яёa-z])|\d[\d\s.]*\s?(₫|vnd|донг)|\d{2,3}[\s.]?000(?!\d)|\/\s?(кг|kg|шт|гр?|л)(?![а-яёa-z])/i,
  /в\s+наличии|наличие|предзаказ|под\s+заказ|на\s+заказ/i,
  /(?<![а-яё])(готовим|готовлю|делаю|делаем|пеку|печём|печем|шью|вяжу)(?![а-яё])|собственного\s+(производства|пошива)|ручн(ая|ой|ую)\s+работ|домашн(ие|ий|яя|ее|их)|handmade/i,
  /доставк|самовывоз/i,
];
// Перепродажа и барахолка: вещь не сделана автором.
const RESALE = /(?<![а-яё])(продам|отдам|продаю\s+б\/у|б\/у)(?![а-яё])|надевал|за\s+ненадобностью|уезжа[юем]|(?<![а-яё])торг(?![а-яё])|привез[а-яё]*\s+из\s+росси|в\s+идеальном\s+состоянии/i;
// Услуги — это Practice («Услуги»), а не товар.
const SERVICE = /(?<![а-яё])(массаж|маникюр|педикюр|наращивани|стрижк|косметолог|урок|заняти|тренировк|консультац|сеанс)|запись\s+(в\s+лс|в\s+личк|открыта|по\s+ссылк)|записаться/i;

/** Похоже ли сообщение на товар мастера: не барахолка, не услуга и хотя бы два разных признака. */
export const looksLikeProduct = (text) => text.length >= 40 && text.length <= 4000
  && !RESALE.test(text) && !SERVICE.test(text) && MAKER.filter((re) => re.test(text)).length >= 2;

// Закрытый чат задаётся числовым id (-100…): username у него нет, ссылка — t.me/c/….
const isPrivate = (chat) => /^-?\d+$/.test(chat);
const postUrl = (chat, id) => (isPrivate(chat) ? `https://t.me/c/${chat.replace(/^-100/, '')}/${id}` : `https://t.me/${chat}/${id}`);

/**
 * Посты-кандидаты среди сообщений источника (от старых к новым), не старше `maxAgeMs`. У каждого — альбом (фото
 * публикации) и автор, если это человек с username: в группе он контакт, когда в тексте контакта нет. Повтор того же
 * текста (в группах объявление выкладывают пачками) — один, последний.
 */
export function pickProducts(chat, messages, { now = Date.now(), maxAgeMs = Infinity } = {}) {
  const byText = new Map();
  for (const m of messages) {
    const s = m.sender;
    if (!m.message || s?.bot || now - m.date * 1000 > maxAgeMs || !looksLikeProduct(m.message)) continue;
    const person = s?.className === 'User' && s.username;
    const key = m.message.toLowerCase().replace(/\s+/g, ' ').trim();
    byText.delete(key); // Map держит порядок вставки: повтор встаёт на место последнего
    byText.set(key, {
      id: `${chat}/${m.id}`,
      number: m.id,
      url: postUrl(chat, m.id),
      posted_at: new Date(m.date * 1000).toISOString(),
      text: m.message,
      author: person ? { id: Number(s.id), name: [s.firstName, s.lastName].filter(Boolean).join(' ') || s.username, username: s.username.toLowerCase() } : null,
      album: m.groupedId ? messages.filter((o) => String(o.groupedId) === String(m.groupedId)).sort((a, b) => a.id - b.id) : [m],
    });
  }
  return [...byText.values()];
}

/**
 * Чей это товар, username без @. В канале мастера — Host источника (тогда null: id уже известен). В группе — контакт
 * из текста (тот, что назвал ИИ, только если он правда есть в тексте; иначе первый), иначе автор, иначе сам чат:
 * пост канала без контакта — товар этого канала (resolveAuthor примет канал и откажет группе).
 */
export function makerOf(source, post, contact) {
  if (source.host_id) return null;
  const inText = contactsIn(post.text).filter((u) => u !== source.channel.toLowerCase());
  return (contact && inText.includes(contact) ? contact : inText[0]) ?? post.author?.username ?? (isPrivate(source.channel) ? null : source.channel.toLowerCase());
}

/**
 * Разобрать посты ИИ и сохранить товары. `source` — из store.productSources(); `resolve(username)` — кто это в Telegram
 * (resolveAuthor); `photo(post)` — адрес первого фото поста в бакете или null. Возвращает { products, hosts }:
 * сколько товаров записано (новых и обновлённых) и username или id их мастеров.
 * Пост, который уже видели (тот же текст, объявление повторяют каждый день), в ИИ не идёт: его товары только
 * сдвигают posted_at.
 */
export async function saveProducts({ store, extractProducts, resolve, photo, pause }, source, posts) {
  let products = 0;
  const hosts = new Set();
  for (const post of posts) {
    try {
      if (await store.touchProducts({ text: post.text, url: post.url, posted_at: post.posted_at })) {
        console.log(`товары ${post.url}: повтор — сдвинули дату`);
        continue;
      }
      const author = source.host_id ? `канал мастера @${source.host_username ?? source.channel}` : post.author ? `${post.author.name} (@${post.author.username}) в группе объявлений` : `группа объявлений @${source.channel}`;
      const { contact, products: found } = await extractProducts(post.id, author, post.text);
      await pause();
      if (!found.length) continue;
      const host = await masterOf({ store, resolve }, source, post, contact);
      if (!host) {
        console.log(`товары ${post.url}: мастера не найти — пропуск`);
        continue;
      }
      // Повтор внутри поста (ИИ назвал позицию дважды) — одна строка, первая: ключ тот же, что у базы.
      const unique = found.filter((p, i) => found.findIndex((q) => productTitleKey(q.title) === productTitleKey(p.title)) === i);
      const saved = await store.saveProducts(host.id, unique, { announcement: { url: post.url, text: post.text }, posted_at: post.posted_at, photo_url: await photo(post) });
      products += saved.length;
      hosts.add(host.id);
      console.log(`товары ${post.url}: ${unique.map((p) => p.title).join(', ')} — записано ${saved.length}, новых ${saved.filter((r) => r.created).length}`);
    } catch (e) {
      // FLOOD_WAIT и отказ ИИ (лимит, перегрузка) — бросаем: отметка источника не сдвинется, и посты перечитаются
      // в следующий проход; уже разобранные тогда не пойдут в ИИ — touchProducts узнает их по тексту.
      if (e.seconds || e.status === 429 || e.status >= 500) throw e;
      console.error(`товары ${post.url}: ${e.status ?? ''} ${e.message.slice(0, 120)}`); // прочее: этот пост пропустим
    }
  }
  return { products, hosts: hosts.size };
}

/**
 * Host товара: { id } или null — мастера не найти или команда его отклонила. Нового мастера создаём с городом источника;
 * в Telegram ищем, только когда его ещё нет в hosts: поиск по username флудоопасен.
 */
async function masterOf({ store, resolve }, source, post, contact) {
  if (source.host_id) return source.host_status === 'rejected' ? null : { id: source.host_id };
  const username = makerOf(source, post, contact);
  if (!username) return null;
  const known = await store.hostByUsername(username);
  if (known) return known.status === 'rejected' ? null : known;
  const who = post.author?.username === username ? post.author : await resolve(username);
  if (!who) return null;
  const host = await store.saveMaker({ telegram_id: who.id, username, name: who.name, city_id: source.city_id, offer_url: post.url });
  console.log(`мастер @${username}: новый Host из товаров (${post.url})`);
  return host.status === 'rejected' ? null : host;
}

/** Первое фото поста в бакет: products/<чат>/<номер>.jpg. Без бакета, без фото или при сбое — null: товар сохранится без фото. */
export async function uploadFirstPhoto({ bucket, downloadPhotos }, post) {
  if (!bucket) return null;
  const first = post.album.find((m) => m.media?.className === 'MessageMediaPhoto');
  try {
    const [p] = first ? await downloadPhotos([first]) : [];
    // Размер в ключе: файл другого размера — другой адрес, CDN не отдаст старую копию (как uploadMedia в main.mjs).
    return p ? await bucket.put(`products/${post.id.replace(/\/\d+$/, '')}/${p.number}_${p.width ?? 0}x${p.height ?? 0}.jpg`, p.data, 'image/jpeg') : null;
  } catch (e) {
    console.error(`фото товара ${post.url}: ${e.message}`);
    return null;
  }
}
