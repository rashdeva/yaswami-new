// Город и чаты для разовых скриптов сборщика (find-sources, scout, backfill-jobs, backfill-leads, find-masters):
// всё берётся из базы, а не из окружения.
import { DEFAULT_CITY_ID } from '@yaswami/core';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Название города и его другие написания: канал «про город», если город в нём — отдельным словом. Русскому названию
 * можно падежное окончание («в Дананге», «Коломбо», но не «Эллипс» для Эллы), латинскому — нет: иначе Galle находил GT_Gallery, а Kandy — kandybaaa, и поиск
 * источников приносил галереи, рестораны и обменники. В username слова склеены (danangevent, eventnhatrang): там
 * латинское название может стоять в начале или в конце слова, но только длинное — от шести букв, короткое — лишь целиком
 * или между подчёркиваниями (gt_galle).
 */
export function cityMatcher(names) {
  const stems = names.map((n) => n.trim().toLowerCase().replace(/[аяоеыиуьй]$/, '')).filter(Boolean);
  const words = stems.map((s) => escape(s).replace(/\s+/g, '\\s?'));
  const word = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?:[аеиоуыэюяёь][мхйю]?)?(?![\\p{L}\\p{N}])`, 'iu');
  const glued = stems.map((s) => s.replace(/[^a-z0-9]/g, '')).filter((s, i) => s && /^[a-z0-9\s.'-]+$/.test(stems[i]));
  const inUsername = (token) => [token.replace(/_/g, ''), ...token.split('_')].some((t) =>
    glued.some((c) => t === c || (c.length >= 6 && (t.startsWith(c) || t.endsWith(c)))));
  return { test: (text) => word.test(text) || text.toLowerCase().split(/[^a-z0-9_]+/).some((t) => t && inUsername(t)) };
}

/** Город разовых скриптов: CITY_ID (по умолчанию первый), его другие написания из базы и из CITY_ALIASES через запятую. */
export async function scoutCity(store, { CITY_ID = DEFAULT_CITY_ID, CITY_ALIASES = '' } = process.env) {
  const city = (await store.cities()).find((c) => c.id === CITY_ID);
  if (!city) throw new Error(`Города ${CITY_ID} нет в таблице cities`);
  const names = [...new Set([city.name, ...city.aliases, ...CITY_ALIASES.split(',').map((a) => a.trim()).filter(Boolean)])];
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
