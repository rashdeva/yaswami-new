// Город и чаты для разовых скриптов сборщика (find-sources, scout, backfill-leads, find-masters):
// всё берётся из базы, а не из окружения.
import { DEFAULT_CITY_ID } from '@yaswami/core';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Название города и его другие написания; канал «про город», если в названии есть основа любого из них (без окончания: «Дананге»). */
export function cityMatcher(names) {
  const stems = names.map((n) => escape(n.trim().toLowerCase().replace(/[аяоеыиуьй]$/, '')).replace(/\s+/g, '\\s?')).filter(Boolean);
  return new RegExp(stems.join('|'), 'i');
}

/** Город разовых скриптов: CITY_ID (по умолчанию первый), его другие написания из базы и из CITY_ALIASES через запятую. */
export async function scoutCity(store, { CITY_ID = DEFAULT_CITY_ID, CITY_ALIASES = '' } = process.env) {
  const city = (await store.cities()).find((c) => c.id === CITY_ID);
  if (!city) throw new Error(`Города ${CITY_ID} нет в таблице cities`);
  const names = [...new Set([city.name, ...city.aliases, ...CITY_ALIASES.split(',').map((a) => a.trim()).filter(Boolean)])];
  return { ...city, names, local: cityMatcher(names) };
}

/**
 * Чаты для прохода по истории: из аргументов или, без них, чаты города из источников (`kind` leads). Чат из аргументов,
 * которого нет среди источников, читается в первом городе — его мастера получат этот город.
 */
export async function chatsToRead(store, args) {
  const known = await store.chats();
  if (!args.length) return known;
  const [first] = await store.cities();
  return args.map((a) => known.find((c) => c.chat.toLowerCase() === a.replace(/^@/, '').toLowerCase())
    ?? { chat: a.replace(/^@/, ''), city_id: first.id, city: first.name });
}
