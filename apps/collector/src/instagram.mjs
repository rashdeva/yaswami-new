// Instagram — через акторы Apify, без логина и без своего аккаунта (ADR-0001): публикации профилей-источников и поиск
// профилей города по хэштегам. Официальный Graph API читает только бизнес-аккаунты и требует проверки бизнеса в Meta.
import { looksLikeEvent } from '@yaswami/extract';
import sharp from 'sharp';

const API = 'https://api.apify.com/v2';
const DONE = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'];

/**
 * Клиент Apify или null без токена. Каждый запуск ограничен суммой `maxUsd` и числом записей `maxItems`: акторы
 * берут деньги за запись, и ошибка в запросе не должна съесть месячный бюджет.
 */
export function createInstagram({ token, maxUsd = 0.5, fetch = globalThis.fetch }) {
  if (!token) return null;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const get = async (path) => {
    const res = await fetch(`${API}${path}`, { headers, signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`Apify ${path}: ${res.status}`);
    return res.json();
  };
  /** Запустить актор и дождаться записей. Запуск идёт минуты: ждём по минуте, не дольше 20. */
  async function run(actor, input, maxItems) {
    const query = new URLSearchParams({ maxItems: String(maxItems), maxTotalChargeUsd: String(maxUsd) });
    const res = await fetch(`${API}/acts/${actor}/runs?${query}`, { method: 'POST', headers, body: JSON.stringify(input), signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Apify ${actor}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    let { data } = await res.json();
    for (let minutes = 0; !DONE.includes(data.status); minutes++) {
      if (minutes >= 20) throw new Error(`Apify ${actor}: запуск ${data.id} идёт дольше 20 минут`);
      ({ data } = await get(`/actor-runs/${data.id}?waitForFinish=60`));
    }
    if (data.status !== 'SUCCEEDED') throw new Error(`Apify ${actor}: запуск ${data.id} — ${data.status}`);
    const items = await get(`/datasets/${data.defaultDatasetId}/items?clean=true`);
    for (const e of items.filter((i) => i.error)) console.error(`Instagram ${e.url ?? e.inputUrl ?? ''}: ${e.error} ${e.errorDescription ?? ''}`);
    return items.filter((i) => !i.error && i.shortCode);
  }
  return {
    /** Публикации профилей новее `since`, не больше `perProfile` с каждого. */
    posts: (handles, since, perProfile = 10) => run('apify~instagram-scraper', {
      directUrls: handles.map((h) => `https://www.instagram.com/${h}/`), resultsType: 'posts', resultsLimit: perProfile,
      onlyPostsNewerThan: since.toISOString(), addParentData: false,
    }, handles.length * perProfile),
    /** Свежие публикации по хэштегам, не больше `perTag` с каждого. */
    hashtags: (tags, perTag = 25) => run('apify~instagram-hashtag-scraper', { hashtags: tags, resultsLimit: perTag }, tags.length * perTag),
  };
}

/** Публикация Instagram в виде, который видит ИИ; `number` — время публикации в секундах, им же двигается отметка источника. */
export function toAnnouncement(post) {
  const published = new Date(post.timestamp);
  return {
    id: post.shortCode, number: Math.floor(published.getTime() / 1000), url: post.url ?? `https://www.instagram.com/p/${post.shortCode}/`,
    text: post.caption ?? '', published_at: published.toISOString(), author_username: post.ownerUsername?.toLowerCase() ?? null, platform: 'instagram',
  };
}

/** Отклик как у публикации Telegram: просмотры ролика и лайки. Скрытые лайки Instagram отдаёт как -1. */
export const toStats = (post) => ({
  views: post.videoViewCount ?? post.videoPlayCount ?? null,
  reactions: post.likesCount >= 0 ? post.likesCount : null,
});

/**
 * Фото публикации по порядку карусели и ролик, если он есть: [{ type, url, number, width, height }]. Ссылки CDN живут
 * недолго — качать сразу. Размеры ролика — из ответа Apify (у карусели — его элемента): по ним сайт решает, ставить ли
 * вертикальный ролик обложкой. У ролика без размеров их нет.
 */
export function mediaOf(post) {
  const child = post.childPosts?.find((c) => c.videoUrl === post.videoUrl);
  const size = (p) => ({ width: p?.dimensionsWidth ?? null, height: p?.dimensionsHeight ?? null });
  return [
    ...(post.images?.length ? post.images : [post.displayUrl]).filter(Boolean).map((url, number) => ({ type: 'photo', url, number })),
    ...(post.videoUrl ? [{ type: 'video', url: post.videoUrl, number: 0, ...size(child ?? post) }] : []),
  ];
}

/**
 * Фото в JPEG, длинная сторона не больше `side`: Instagram отдаёт и WebP, и снимки по 2–3 МБ, а ИИ и сайт ждут
 * лёгкий JPEG. null — не картинка. Ролики не пережимаем: Instagram уже сжал их в H.264 (обычно 2–10 МБ).
 */
export async function toJpeg(data, side = 1280, quality = 80) {
  try {
    const { data: out, info } = await sharp(data).rotate().resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return { data: out, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/** Файл по ссылке CDN или null, если он тяжелее `max` или не скачался. */
export async function download(url, max, fetch = globalThis.fetch) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > max) return null;
    const data = Buffer.from(await res.arrayBuffer());
    return data.length <= max ? { data, mime: res.headers.get('content-type') ?? '' } : null;
  } catch {
    return null;
  }
}

/**
 * Хэштеги города: название без пробелов и, у латинских написаний, с частыми приставками (#danangevents).
 * ponytail: четыре приставки — каждая стоит денег за найденные публикации; расширять, если находок мало.
 */
export function cityHashtags(names, suffixes = ['', 'events', 'party', 'yoga']) {
  const tags = new Set();
  for (const name of names) {
    const base = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (!base) continue;
    for (const s of /^[a-z0-9]+$/.test(base) ? suffixes : ['']) tags.add(base + s);
  }
  return [...tags];
}

/**
 * Кандидаты в источники из публикаций по хэштегам — в форме SourceCandidate: профиль, сколько его публикаций за 30 дней
 * нашлось и сколько из них похожи на анонс. Лучшие первыми.
 */
export function candidatesFrom(posts, now = Date.now()) {
  const since = now - 30 * 86_400_000;
  const byOwner = new Map();
  for (const p of posts) {
    const handle = p.ownerUsername?.toLowerCase();
    if (!handle || new Date(p.timestamp).getTime() < since) continue;
    const seen = byOwner.get(handle) ?? byOwner.set(handle, { title: p.ownerFullName || handle, codes: new Set(), event_like: 0 }).get(handle);
    if (seen.codes.has(p.shortCode)) continue; // одна публикация под несколькими хэштегами
    seen.codes.add(p.shortCode);
    if (looksLikeEvent(p.caption ?? '')) seen.event_like++;
  }
  return [...byOwner].map(([handle, s]) => ({
    channel: `instagram:${handle}`, title: s.title, group: false, members: null, posts_30d: s.codes.size, event_like: s.event_like, kind: 'announcements',
  })).sort((a, b) => b.event_like - a.event_like || b.posts_30d - a.posts_30d);
}
