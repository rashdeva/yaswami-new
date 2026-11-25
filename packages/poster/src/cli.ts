// Афиша недели из живой витрины: PNG-слайды и текст поста в папку.
//   node packages/poster/src/cli.ts --city danang --from 2026-11-26 [--days 7] [--out poster-out] [--api https://yaswami.com]
// Читает только публичные ручки API, поэтому годится и для прода, и для локальной базы.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { City, CollectedEventItem } from '@yaswami/core';
import { pickPosterDays, posterCaption, posterDays, renderPoster } from './index.ts';

// Предложный падеж и обложка города. В базе их нет; новый город без записи получит «в городе X» и обложку без картинки.
const CITY_ART: Record<string, { cityIn: string; hero?: string }> = {
  danang: { cityIn: 'в Дананге', hero: 'danang.png' },
  nhatrang: { cityIn: 'в Нячанге' },
};

const { values } = parseArgs({
  options: {
    city: { type: 'string', default: 'danang' },
    from: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    days: { type: 'string', default: '7' },
    out: { type: 'string', default: 'poster-out' },
    api: { type: 'string', default: 'https://yaswami.com' },
  },
});
const api = values.api.replace(/\/$/, '') + '/api';
const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(api + path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
};

const [cities, events, config] = await Promise.all([
  get<City[]>('/cities'),
  get<CollectedEventItem[]>(`/collected-events?city_id=${encodeURIComponent(values.city)}`),
  get<{ bot_username: string | null }>('/config'),
]);
const city = cities.find((c) => c.id === values.city);
if (!city) throw new Error(`города ${values.city} нет`);
const art = CITY_ART[city.id];
const range = new Set(posterDays(values.from, Number(values.days)));
const week = events.filter((e) => range.has(e.starts_at.slice(0, 10)));
const days = pickPosterDays(week, { from: values.from, days: Number(values.days) });
const assets = {
  city: city.name,
  cityIn: art?.cityIn ?? `в городе ${city.name}`,
  hero: art?.hero && new URL(`../assets/${art.hero}`, import.meta.url).pathname,
  bot: config.bot_username ?? 'yaswamibot',
};

const out = resolve(values.out);
await mkdir(out, { recursive: true });
const slides = await renderPoster(days, week.length, assets);
for (const s of slides) await writeFile(join(out, s.name + '.png'), s.png);
await writeFile(join(out, 'caption.txt'), posterCaption(days, week.length, assets.cityIn, assets.bot) + '\n');
console.log(`${slides.length} слайдов и caption.txt → ${out}`);
