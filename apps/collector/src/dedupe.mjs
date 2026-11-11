// Один и тот же анонс организаторы повторяют: расписание, отдельный пост, напоминание.
// ponytail: эвристика по дню, времени, контакту и словам названия. Два разных события одного организатора
// в одно и то же время она склеит; переформулированное название без контакта — пропустит.

const day = (e) => e.starts_at.slice(0, 10);
const time = (e) => e.starts_at.slice(11, 16);
const contact = (e) => e.telegram_username?.replace(/^@/, '').toLowerCase() || e.whatsapp_phone?.replace(/\D/g, '') || null;
const words = (e) => new Set(e.title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);

function titleSimilarity(a, b) {
  const [x, y] = [words(a), words(b)];
  const common = [...x].filter((w) => y.has(w)).length;
  return common / (x.size + y.size - common || 1);
}

export function isSameEvent(a, b) {
  if (day(a) !== day(b)) return false;
  // 00:00 — «время не указано» (так просит промпт), с ним совпадает любое время этого дня.
  const sameTime = time(a) === time(b) || time(a) === '00:00' || time(b) === '00:00';
  const sameContact = contact(a) && contact(a) === contact(b);
  return sameTime && (sameContact || titleSimilarity(a, b) >= 0.6);
}

// Берём известное из обоих: напоминание без деталей не должно затирать полный анонс, и наоборот.
export function mergeEvents(known, fresh) {
  const merged = { ...known };
  for (const [k, v] of Object.entries(fresh)) if (merged[k] == null || merged[k] === '') merged[k] = v;
  if (time(known) === '00:00' && time(fresh) !== '00:00') Object.assign(merged, { starts_at: fresh.starts_at, ends_at: fresh.ends_at });
  if (fresh.description.length > known.description.length) merged.description = fresh.description;
  return merged;
}
