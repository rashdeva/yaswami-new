// Страницы, которые сервер отдаёт уже с содержимым: витрина и собранное событие. Поисковик и человек с медленной
// сетью видят текст сразу; затем то же место занимает приложение (apps/web) и берёт данные из <script id="initial">.
import type { CollectedEventItem } from '@yaswami/core';
import { collectedDay, collectedDayKey, collectedIsPast, collectedPath, collectedTime, collectedWhen } from '@yaswami/core';

export interface Page {
  status: 200 | 404;
  title: string;
  description: string;
  canonical: string;
  body: string;
  /** Данные, с которых приложение стартует без запроса к API. */
  initial: object;
  jsonLd?: object;
  noindex?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Внутри <script> опасна только последовательность, закрывающая тег.
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
const short = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);
const line = (e: CollectedEventItem) => [collectedTime(e.starts_at), e.place, e.price].filter(Boolean).join(' · ');

export function feedPage(items: CollectedEventItem[], publicUrl: string, city: string): Page {
  const days = Map.groupBy(items, (e) => collectedDayKey(e.starts_at));
  const body = [...days.values()]
    .map((list) => `<h2>${esc(collectedDay(list[0]!.starts_at))}</h2><ul>${list
      .map((e) => `<li><a href="${collectedPath(e.id)}">${esc(e.title)}</a>${line(e) && ` — ${esc(line(e))}`}</li>`)
      .join('')}</ul>`)
    .join('');
  return {
    status: 200,
    title: `События в городе ${city} — Я с вами`,
    description: `Куда пойти в городе ${city}: ${items.length ? short(items.slice(0, 5).map((e) => e.title).join(', '), 120) : 'встречи, мастер-классы и практики'}. Афиша собирается из анонсов организаторов.`,
    canonical: `${publicUrl}/`,
    body: `<main><h1>События · ${esc(city)}</h1>${body || '<p>Пока ничего не запланировано.</p>'}</main>`,
    initial: { feed: items },
  };
}

export function eventPage(e: CollectedEventItem, publicUrl: string, city: string): Page {
  const canonical = publicUrl + collectedPath(e.id);
  const where = [e.place, e.address].filter(Boolean).join(', ');
  return {
    status: 200,
    title: `${e.title} — ${collectedWhen(e.starts_at)}, ${city}`,
    description: short([collectedWhen(e.starts_at), where, e.price, e.description].filter(Boolean).join('. '), 200),
    canonical,
    body: `<main><h1>${esc(e.title)}</h1><p>${esc(collectedWhen(e.starts_at))}</p>${where && `<p>${esc(where)}</p>`}${
      e.price ? `<p>${esc(e.price)}</p>` : ''}<p>${esc(e.description)}</p><p><a href="/">Все события · ${esc(city)}</a></p></main>`,
    initial: { event: e },
    noindex: collectedIsPast(e),
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: e.title,
      description: e.description,
      startDate: e.starts_at,
      ...(e.ends_at ? { endDate: e.ends_at } : {}),
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: { '@type': 'Place', name: e.place ?? city, address: e.address ?? city },
      url: canonical,
    },
  };
}

export const notFoundPage = (publicUrl: string): Page => ({
  status: 404,
  title: 'Событие не найдено — Я с вами',
  description: 'Такого события нет: возможно, оно уже прошло.',
  canonical: `${publicUrl}/`,
  body: '<main><h1>Событие не найдено</h1><p><a href="/">Все события</a></p></main>',
  initial: {},
  noindex: true,
});

/** Вставляет страницу в собранный index.html приложения. */
export function inject(template: string, page: Page): string {
  const head = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${esc(page.canonical)}" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${esc(page.canonical)}" />`,
    page.noindex ? '<meta name="robots" content="noindex" />' : '',
    page.jsonLd ? `<script type="application/ld+json">${scriptJson(page.jsonLd)}</script>` : '',
  ].join('');
  // Функции вместо строк замены: в тексте события может встретиться «$&».
  return template
    .replace(/<title>[\s\S]*?<\/title>/, () => head)
    .replace('<div id="app"></div>', () => `<div id="app">${page.body}</div><script id="initial" type="application/json">${scriptJson(page.initial)}</script>`);
}

export function sitemap(items: CollectedEventItem[], publicUrl: string): string {
  const urls = ['/', ...items.map((e) => collectedPath(e.id))].map((path) => `<url><loc>${esc(publicUrl + path)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
}
