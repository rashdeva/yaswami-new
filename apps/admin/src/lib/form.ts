// Чистые функции форм: время на стене часового пояса, изменённые поля, ошибки полей от сервера. Без React.

const OFFSET = /^(?:Z|[+-]\d\d:\d\d)$/;

/** Дата и время на стене часового пояса: ['2026-11-20', '19:30']. Та же функция, что в apps/web/src/format.ts. */
export function wallParts(iso: string, timeZone: string): [string, string] {
  const [date, time] = new Date(iso).toLocaleString('sv-SE', { timeZone, hour12: false }).split(' ');
  return [date!, time!.slice(0, 5)];
}

/** Обратное: дата и время на стене часового пояса → момент (ISO). */
export function fromWall(date: string, time: string, timeZone: string): string {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const [d, t] = wallParts(new Date(guess).toISOString(), timeZone);
  // ponytail: поправка по смещению в момент guess; в сам час перевода часов может промахнуться на час
  return new Date(guess - (Date.parse(`${d}T${t}:00Z`) - guess)).toISOString();
}

const offsetMinutes = (offset: string) => (offset === 'Z' ? 0 : (offset[0] === '-' ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))));

/**
 * Значение для `<input type="datetime-local">`: момент на стене пояса. `zone` — IANA-пояс события (`Asia/Tbilisi`)
 * или смещение (`+07:00`) — так хранит время собранное событие.
 */
export function toLocal(iso: string, zone: string): string {
  if (OFFSET.test(zone)) return new Date(Date.parse(iso) + offsetMinutes(zone) * 60_000).toISOString().slice(0, 16);
  return wallParts(iso, zone).join('T');
}

/** Обратное к `toLocal`: со смещением — ISO с ним же (`2026-11-20T19:00:00+07:00`), с поясом — ISO в UTC. */
export function fromLocal(local: string, zone: string): string {
  if (OFFSET.test(zone)) return `${local}:00${zone}`;
  const [date, time] = local.split('T');
  return fromWall(date!, time!, zone);
}

/** Смещение в конце ISO-строки: `+07:00`, `Z`; нет — `Z`. */
export const offsetOf = (iso: string) => /(Z|[+-]\d\d:\d\d)$/.exec(iso)?.[1] ?? 'Z';

/**
 * Только изменённые поля верхнего уровня — их и шлём: в журнал попадает то, что правили, а поля, которых сервер
 * не отдал (пустые в форме), не затираются.
 */
export function pickDirty<T extends Record<string, unknown>>(values: T, dirty: Partial<Record<keyof T, unknown>>): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => hasTrue(dirty[key]))) as Partial<T>;
}
const hasTrue = (d: unknown): boolean => d === true || (Array.isArray(d) ? d.some(hasTrue) : !!d && typeof d === 'object' && Object.values(d).some(hasTrue));

/** Ошибки полей из ответа `invalid_input`: путь `a.b` → текст. Путь пустой — ошибка всей формы, её не возвращаем. */
export function issueFields(issues: { path?: (string | number)[]; message?: string }[] | undefined): [string, string][] {
  return (issues ?? []).filter((i) => i.path?.length).map((i) => [i.path!.join('.'), i.message ?? 'Неверное значение']);
}

/** Текст поля «по строке» или «через запятую» → список без пустых. */
export const splitList = (text: string, by: 'line' | 'comma') => text.split(by === 'line' ? '\n' : ',').map((s) => s.trim()).filter(Boolean);
