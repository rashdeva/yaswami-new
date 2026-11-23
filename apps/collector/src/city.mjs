// Город и чаты для разовых скриптов сборщика (find-sources, scout, backfill-jobs, backfill-leads, find-masters):
// всё берётся из базы, а не из окружения.
import { DEFAULT_CITY_ID } from '@yaswami/core';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Название города и его другие написания; канал «про город», если в названии есть основа любого из них (без окончания: «Дананге»). */
export function cityMatcher(names) {
  const stems = names.map((n) => escape(n.trim().toLowerCase().replace(/[аяоеыиуьй]$/, '')).replace(/\s+/g, '\\s?')).filter(Boolean);
  return new RegExp(stems.join('|'), 'i');
}

/** Город разовых скриптов: CITY_ID (по умолчанию первый) и другие его написания из CITY_ALIASES через запятую. */
export async function scoutCity(store, { CITY_ID = DEFAULT_CITY_ID, CITY_ALIASES = '' } = process.env) {
  const city = (await store.cities()).find((c) => c.id === CITY_ID);
  if (!city) throw new Error(`Города ${CITY_ID} нет в таблице cities`);
  const names = [city.name, ...CITY_ALIASES.split(',').map((a) => a.trim()).filter(Boolean)];
  return { ...city, names, local: cityMatcher(names) };
}

/**
 * Чаты для прохода по истории: из аргументов или, без них, источники вида `kinds`. Чат из аргументов, которого нет
 * среди источников, читается в первом городе — его мастера и вакансии получат этот город.
 */
export async function chatsToRead(store, args, kinds) {
  const known = await store.chats();
  if (!args.length) return known.filter((c) => kinds.includes(c.leads ? 'leads' : 'jobs'));
  const [first] = await store.cities();
  return args.map((a) => known.find((c) => c.chat.toLowerCase() === a.replace(/^@/, '').toLowerCase())
    ?? { chat: a.replace(/^@/, ''), leads: true, city_id: first.id, city: first.name });
}
