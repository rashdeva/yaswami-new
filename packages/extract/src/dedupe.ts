// Один и тот же анонс организаторы повторяют: расписание, отдельный пост, напоминание.
// ponytail: эвристика по дню, времени, контакту и словам названия. Два разных события одного организатора
// в одно и то же время она склеит; переформулированное название без контакта — пропустит.
import type { CollectedEvent } from '@yaswami/core';

type E = CollectedEvent;
const day = (e: E) => e.starts_at.slice(0, 10);
const time = (e: E) => e.starts_at.slice(11, 16);
const contact = (e: E) => e.telegram_username?.replace(/^@/, '').toLowerCase() || e.whatsapp_phone?.replace(/\D/g, '') || null;
const words = (e: E) => new Set(e.title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);

function titleSimilarity(a: E, b: E) {
  const [x, y] = [words(a), words(b)];
  const common = [...x].filter((w) => y.has(w)).length;
  return common / (x.size + y.size - common || 1);
}

export function isSameEvent(a: E, b: E): boolean {
  if (day(a) !== day(b)) return false;
  // 00:00 — «время не указано» (так просит промпт), с ним совпадает любое время этого дня.
  const sameTime = time(a) === time(b) || time(a) === '00:00' || time(b) === '00:00';
  const sameContact = contact(a) && contact(a) === contact(b);
  return sameTime && !!(sameContact || titleSimilarity(a, b) >= 0.6);
}

const likeWords = (e: E) => new Set(`${e.title} ${e.tags.join(' ')}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
/** Похожесть по словам названия и меток: из нескольких кандидатов в дубли выбирает самого похожего. */
function likeness(a: E, b: E) {
  const [x, y] = [likeWords(a), likeWords(b)];
  const common = [...x].filter((w) => y.has(w)).length;
  return common / (x.size + y.size - common || 1);
}

/**
 * Дубли для событий одной публикации: `i`-му событию — известное событие или undefined (новое).
 * Расписание клуба — несколько занятий в одно время у одного контакта (студия А и студия Б): по isSameEvent они
 * все «одно событие». Поэтому: события одной публикации друг с другом не склеиваются — `own(k)` даёт номер события
 * в этой же публикации, и такое известное совпадает только с событием под тем же номером (повторный разбор поста);
 * известное событие берёт не больше одного события публикации, и пары подбираются от самых похожих — перепост
 * расписания из агрегатора склеивается занятие с занятием, а не первое попавшееся.
 */
export function pairEvents<K extends { event: E }>(fresh: E[], known: K[], own: (k: K) => number | null = () => null): (K | undefined)[] {
  const pairs: { i: number; j: number; score: number }[] = [];
  fresh.forEach((e, i) => known.forEach((k, j) => {
    const n = own(k);
    if (n != null ? n === i : isSameEvent(k.event, e)) pairs.push({ i, j, score: n === i ? 2 : likeness(k.event, e) });
  }));
  pairs.sort((a, b) => b.score - a.score);
  const out: (K | undefined)[] = new Array(fresh.length).fill(undefined);
  const used = new Set<number>();
  for (const { i, j } of pairs) if (!out[i] && !used.has(j)) { out[i] = known[j]; used.add(j); }
  return out;
}

// Берём известное из обоих: напоминание без деталей не должно затирать полный анонс, и наоборот.
export function mergeEvents(known: E, fresh: E): E {
  const merged: Record<string, unknown> & E = { ...known };
  const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0); // пусто — и null, и '', и []
  for (const [k, v] of Object.entries(fresh)) if (empty(merged[k])) merged[k] = v;
  if (time(known) === '00:00' && time(fresh) !== '00:00') Object.assign(merged, { starts_at: fresh.starts_at, ends_at: fresh.ends_at });
  if (fresh.description.length > known.description.length) merged.description = fresh.description;
  return merged;
}
