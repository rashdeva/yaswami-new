// Слайды афиши 1080×1350 (4:5 — формат ленты Instagram, Telegram показывает его без обрезки).
// Рисуем satori (разметка на flexbox → SVG) и resvg (SVG → PNG): без браузера, поэтому то же самое потом запустится на сервере.
import { readFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { collectedDay, collectedTime, topicSlug, type CollectedEventItem } from '@yaswami/core';
import type { PosterDay } from './pick.ts';

export const W = 1080;
export const H = 1350;

const INK = '#1d1b19';
const HINT = 'rgba(29, 27, 25, 0.58)';
const CREAM = '#fcf5ea'; // фон иллюстраций Codex: слайд сливается с картинкой без вырезания

const root = new URL('../../../', import.meta.url);
const file = (path: string) => readFile(new URL(path, root));

// --- шрифты: Unbounded — заголовки, Inter — текст. Fontsource режет шрифт на наборы знаков, а satori с одинаковым
// именем берёт только один файл — поэтому у каждого набора своё имя, и в fontFamily они перечислены цепочкой.
// Вьетнамский набор нужен для названий мест («Đi Lạc Coffee») и знака донга.
const SUBSETS = ['latin', 'cyrillic', 'latin-ext', 'vietnamese'];
const family = (name: 'Unbounded' | 'Inter') => SUBSETS.map((s) => `${name}-${s}`).join(', ');
const UNB = family('Unbounded');
const INTER = family('Inter');

async function fonts() {
  const load = (name: string, slug: string, weight: 400 | 500 | 600 | 700 | 800) =>
    SUBSETS.map(async (subset) => ({
      name: `${name}-${subset}`, weight, style: 'normal' as const,
      data: await file(`packages/poster/node_modules/@fontsource/${slug}/files/${slug}-${subset}-${weight}-normal.woff`),
    }));
  return Promise.all([
    ...load('Unbounded', 'unbounded', 700), ...load('Unbounded', 'unbounded', 800),
    ...load('Inter', 'inter', 500), ...load('Inter', 'inter', 600), ...load('Inter', 'inter', 700),
  ]);
}

// --- цвет темы: один источник — apps/web/src/tokens.css, там же его видит мини-приложение.
async function topicColors(): Promise<Record<string, string>> {
  const css = (await file('apps/web/src/tokens.css')).toString();
  return Object.fromEntries([...css.matchAll(/\[data-topic='([a-z-]+)'\]\s*\{\s*--c:\s*(#[0-9a-f]{6})/g)].map((m) => [m[1]!, m[2]!]));
}

const dataUri = (mime: string, bytes: Buffer | ArrayBuffer) => `data:${mime};base64,${Buffer.from(bytes as ArrayBuffer).toString('base64')}`;

async function topicIcon(slug: string): Promise<string> {
  // slug приходит из API и становится частью пути к файлу: «../» вывел бы чтение за папку иконок. Чужой вид — как неизвестная тема.
  const safe = /^[a-z0-9-]+$/.test(slug) ? slug : 'other';
  const icon = await file(`apps/web/public/topics/${safe}.png`).catch(() => file('apps/web/public/topics/other.png'));
  return dataUri('image/png', icon);
}

async function cover(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const res = await fetch(url).catch(() => null);
  const type = res?.headers.get('content-type') ?? '';
  if (!res?.ok || !/image\/(jpeg|png)/.test(type)) return null; // webp и видео satori не рисует — будет иконка темы
  return dataUri(type, await res.arrayBuffer());
}

// --- разметка без JSX: satori принимает объекты { type, props }.
type Node = { type: string; props: Record<string, unknown> } | string | null | false;
type Style = Record<string, string | number>;
const h = (type: string, style: Style, ...children: Node[]): Node =>
  ({ type, props: { style: { display: 'flex', ...style }, children: children.filter((c) => c !== null && c !== false) } });
const img = (src: string, style: Style): Node => ({ type: 'img', props: { src, style } });
const text = (value: string, style: Style, lines?: number): Node =>
  h('div', lines ? { display: 'block', lineClamp: lines, ...style } : style, value);

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

/** «26 ноября — 2 декабря»; месяц у первой даты опускаем, если он тот же. */
export function weekRange(first: string, last: string): string {
  const fmt = (d: string, month: boolean) =>
    new Intl.DateTimeFormat('ru', { timeZone: 'UTC', day: 'numeric', ...(month && { month: 'long' }) }).format(new Date(d + 'T12:00:00Z'));
  return `${fmt(first, first.slice(5, 7) !== last.slice(5, 7))} — ${fmt(last, true)}`;
}

/**
 * Описание под названием: своими словами организатора из анонса, а если оно короткое — дополняем тем, для кого это
 * и что человек унесёт. Обрезку по строкам делает слайд, здесь — только верхняя граница длины.
 */
export function about(e: CollectedEventItem, max = 320): string {
  const parts = [e.description, e.for_whom, e.takeaway, e.what_happens?.join(', ')]
    .map((p) => p?.replace(/\s+/g, ' ').trim()).filter((p): p is string => !!p);
  let out = parts[0] ?? '';
  for (const p of parts.slice(1)) if (out.length < 120 && !out.includes(p)) out += (/[.!?…]$/.test(out) ? ' ' : '. ') + cap(p);
  return clip(cap(out), max);
}

// Сколько строк займёт название в колонке 656 px при Unbounded 32: в среднем ~27 знаков на строку.
const titleLines = (title: string) => (clip(title, 60).length > 27 ? 2 : 1);

function brand(city: string, mark: string, tone: 'ink' | 'light' = 'ink'): Node {
  return h('div', { alignItems: 'center', gap: 14 },
    img(mark, { width: 40, height: 45 }),
    text(`Я с вами · ${city}`, { fontFamily: INTER, fontWeight: 700, fontSize: 28, color: tone === 'ink' ? INK : '#fff' }));
}

function chip(label: string, color: string, icon?: string, size = 26): Node {
  return h('div', {
    alignItems: 'center', gap: 10, padding: icon ? '6px 20px 6px 8px' : '8px 20px', borderRadius: 999,
    backgroundColor: color + '1f', color, fontFamily: INTER, fontWeight: 700, fontSize: size,
  }, icon ? img(icon, { width: size * 1.6, height: size * 1.6 }) : null, label);
}

export interface PosterAssets {
  city: string; // «Дананг»: в шапке и в предложном падеже ниже
  cityIn: string; // «в Дананге»
  hero?: string; // путь к иллюстрации обложки на фоне CREAM
  bot: string; // ник бота без @
}

interface Ctx { assets: PosterAssets; mark: string; colors: Record<string, string>; icons: Map<string, string> }

// Стрелки «→» нет в наборах Inter, которые грузим, — рисуем её сами.
const arrow = (color: string) => dataUri('image/svg+xml', Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 12h16m-6-7 7 7-7 7" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`));

const CHIP_SPOTS = [{ left: 72, top: 40 }, { left: 520, top: 20 }, { left: 210, top: 150 }, { left: 640, top: 140 }];

function coverSlide(ctx: Ctx, days: PosterDay[], hero: string | null, total: number): Node {
  const first = days[0]!.day, last = days.at(-1)!.day;
  // Пилюли-оглавление, как у сильных городских медиа: самые частые темы недели.
  const counts = new Map<string, number>();
  for (const d of days) for (const e of d.events) counts.set(e.topic ?? 'другое', (counts.get(e.topic ?? 'другое') ?? 0) + 1);
  const topics = [...counts].filter(([t]) => t !== 'другое').sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
  const tilt = [-4, 3, -2, 4];
  return h('div', { width: W, height: H, flexDirection: 'column', backgroundColor: CREAM },
    h('div', { flexDirection: 'column', padding: '72px 72px 0', gap: 26 },
      brand(ctx.assets.city, ctx.mark),
      text(`Куда пойти ${ctx.assets.cityIn}`, { width: 936, fontFamily: UNB, fontWeight: 800, fontSize: 92, lineHeight: 1.05, color: INK, letterSpacing: -2, marginTop: 20 }),
      h('div', { alignItems: 'center', gap: 18 },
        text(weekRange(first, last), { fontFamily: INTER, fontWeight: 700, fontSize: 40, color: '#fff', backgroundColor: '#ff5a3c', padding: '8px 24px', borderRadius: 18 }),
        text(`${total} ${plural(total, 'событие', 'события', 'событий')} на неделе`, { fontFamily: INTER, fontWeight: 600, fontSize: 34, color: HINT }))),
    // Верхняя треть иллюстрации — пустой фон под заголовок: прижимаем картинку к низу и срезаем лишнее сверху.
    h('div', { flex: 1, flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden', position: 'relative' },
      hero ? img(hero, { width: W, height: W }) : null,
      // Пилюли-оглавление висят над картинкой вразбежку, как стикеры.
      ...topics.map((t, i) => h('div', { position: 'absolute', ...CHIP_SPOTS[i], transform: `rotate(${tilt[i]}deg)`, backgroundColor: '#fff', borderRadius: 999, boxShadow: '0 8px 22px rgba(60,40,20,0.12)' },
        chip(t, ctx.colors[topicSlug(t)] ?? '#64748b', ctx.icons.get(topicSlug(t)), 32))),
      h('div', { position: 'absolute', right: 64, bottom: 56, alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.85)', padding: '12px 26px', borderRadius: 999 },
        text('листай', { fontFamily: INTER, fontWeight: 700, fontSize: 30, color: INK }),
        img(arrow(INK), { width: 32, height: 32 }))));
}

function eventCard(ctx: Ctx, e: CollectedEventItem, photo: string | null): Node {
  const slug = topicSlug(e.topic);
  const color = ctx.colors[slug] ?? '#64748b';
  const icon = ctx.icons.get(slug)!;
  const time = collectedTime(e.starts_at);
  const where = [time, e.place && clip(e.place, 30)].filter(Boolean).join(' · ');
  // Высота постоянная: в дне с одним-двумя событиями карточки не раздуваются, а остаются как на соседних слайдах.
  // 276 — без полей: satori прибавляет padding к height, вместе выходит 320, и три карточки ровно встают в слайд.
  return h('div', { height: 276, backgroundColor: '#fff', borderRadius: 44, padding: 22, gap: 28, boxShadow: '0 10px 30px rgba(60,40,20,0.07)' },
    photo
      ? img(photo, { width: 240, height: '100%', borderRadius: 30, objectFit: 'cover' })
      : h('div', { width: 240, height: '100%', borderRadius: 30, backgroundColor: color + '1f', alignItems: 'center', justifyContent: 'center' }, img(icon, { width: 160, height: 160 })),
    // Ширина колонки задана числом: иначе satori меряет текст по самой длинной строке и карточка вылезает за слайд.
    h('div', { width: 656, flexDirection: 'column', paddingTop: 4, gap: 6 },
      h('div', { alignItems: 'center', gap: 12 },
        chip(e.topic && e.topic !== 'другое' ? e.topic : 'событие', color, icon, 20),
        e.price && text(clip(e.price, 28), { fontFamily: INTER, fontWeight: 600, fontSize: 21, color: HINT })),
      text(clip(e.title, 60), { width: 656, fontFamily: UNB, fontWeight: 700, fontSize: 32, lineHeight: 1.15, color: INK, letterSpacing: -0.5 }, 2),
      where && text(where, { width: 656, fontFamily: INTER, fontWeight: 700, fontSize: 26, color }),
      // Описанию — всё, что осталось в карточке: 4 строки под коротким названием, 3 — под длинным, +1 без времени и места.
      // satori считает высоту по всему тексту, даже с lineClamp и maxHeight, и карточка растёт. Поэтому текст режем заранее:
      // Inter 22 в колонке 656 px — около 55 знаков в строке, берём 46 с запасом на переносы.
      (() => {
        const lines = 5 - titleLines(e.title) + (where ? 0 : 1);
        return text(about(e, lines * 46), { width: 656, fontFamily: INTER, fontWeight: 500, fontSize: 22, lineHeight: 1.28, color: HINT });
      })()));
}

function daySlide(ctx: Ctx, d: PosterDay, photos: (string | null)[], page: string): Node {
  const [weekday, date] = collectedDay(d.day + 'T12:00:00+00:00').split(', ') as [string, string];
  // Поля — margin внутреннего блока: padding в satori прибавляется к ширине и высоте, и низ слайда уезжает за край.
  return h('div', { width: W, height: H, backgroundColor: CREAM }, h('div', { flex: 1, flexDirection: 'column', margin: '64px 56px 48px', gap: 24 },
    h('div', { alignItems: 'flex-end', justifyContent: 'space-between', paddingLeft: 12, paddingRight: 12 },
      h('div', { flexDirection: 'column', gap: 6 },
        text(date, { fontFamily: INTER, fontWeight: 700, fontSize: 34, color: '#ff5a3c' }),
        text(cap(weekday), { fontFamily: UNB, fontWeight: 800, fontSize: 84, lineHeight: 1, color: INK, letterSpacing: -2 })),
      text(page, { fontFamily: INTER, fontWeight: 600, fontSize: 28, color: HINT, paddingBottom: 8 })),
    h('div', { flex: 1, flexDirection: 'column', gap: 20, marginTop: 12 }, ...d.events.map((e, i) => eventCard(ctx, e, photos[i] ?? null))),
    h('div', { alignItems: 'center', justifyContent: 'space-between', paddingLeft: 12, paddingRight: 12 },
      brand(ctx.assets.city, ctx.mark),
      d.more > 0 && text(`+ ещё ${d.more} в этот день`, { fontFamily: INTER, fontWeight: 600, fontSize: 28, color: HINT }))));
}

function finalSlide(ctx: Ctx, more: number): Node {
  const icons = [...ctx.icons.values()].slice(0, 6);
  return h('div', { width: W, height: H, backgroundColor: '#ff5a3c', backgroundImage: 'linear-gradient(160deg, #ff8a3c 0%, #ff5a3c 45%, #e2368f 100%)' },
   h('div', { flex: 1, flexDirection: 'column', justifyContent: 'space-between', margin: 72 },
    brand(ctx.assets.city, ctx.mark, 'light'),
    h('div', { flexWrap: 'wrap', width: 936, justifyContent: 'center', gap: 24 },
      ...icons.map((src, i) => img(src, { width: 210, height: 210, transform: `rotate(${(i % 2 ? 1 : -1) * 7}deg)` }))),
    h('div', { flexDirection: 'column', gap: 28 },
      text(more > 0 ? `Ещё ${more} ${plural(more, 'событие', 'события', 'событий')} и запись в один тап` : 'Запись в один тап',
        { width: 936, fontFamily: UNB, fontWeight: 800, fontSize: 68, lineHeight: 1.1, color: '#fff', letterSpacing: -1.5 }),
      text('Пишешь организатору прямо из Telegram — без звонков и поиска контактов.', { width: 936, fontFamily: INTER, fontWeight: 500, fontSize: 34, lineHeight: 1.35, color: 'rgba(255,255,255,0.9)' }),
      h('div', { alignItems: 'center', gap: 20, marginTop: 12 },
        text(`@${ctx.assets.bot}`, { fontFamily: UNB, fontWeight: 800, fontSize: 48, color: '#ff5a3c', backgroundColor: '#fff', padding: '18px 36px', borderRadius: 999 }),
        text('Сохрани, чтобы не потерять', { fontFamily: INTER, fontWeight: 600, fontSize: 28, color: 'rgba(255,255,255,0.85)' })))));
}

export interface Slide { name: string; png: Buffer }

/** Карусель: обложка, по слайду на день, последний — куда идти записываться. */
export async function renderPoster(days: PosterDay[], total: number, assets: PosterAssets): Promise<Slide[]> {
  if (!days.length) throw new Error('на эти дни событий нет');
  const [fontList, colors, mark] = await Promise.all([fonts(), topicColors(), file('apps/web/public/mark.svg')]);
  const slugs = new Set(['other', ...days.flatMap((d) => d.events.map((e) => topicSlug(e.topic)))]);
  const icons = new Map(await Promise.all([...slugs].map(async (s) => [s, await topicIcon(s)] as const)));
  const ctx: Ctx = { assets, colors, icons, mark: dataUri('image/svg+xml', mark) };
  const hero = assets.hero ? dataUri('image/png', await readFile(assets.hero)) : null;
  const shown = days.reduce((n, d) => n + d.events.length, 0);

  const nodes: [string, Node][] = [['00-cover', coverSlide(ctx, days, hero, total)]];
  for (const [i, d] of days.entries()) {
    const photos = await Promise.all(d.events.map((e) => cover(e.cover_url)));
    nodes.push([`${String(i + 1).padStart(2, '0')}-${d.day}`, daySlide(ctx, d, photos, `${i + 1}/${days.length}`)]);
  }
  nodes.push([`${String(days.length + 1).padStart(2, '0')}-signup`, finalSlide(ctx, total - shown)]);

  return Promise.all(nodes.map(async ([name, node]) => {
    const svg = await satori(node as Parameters<typeof satori>[0], { width: W, height: H, fonts: fontList });
    return { name, png: new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng() };
  }));
}
