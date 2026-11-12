// Чистые функции модерации собранных событий: поля формы, что модератор поменял, время для <input type="datetime-local">.
import type { AdminCollectedEvent, CollectedUpdateInput, Wire } from '@yaswami/core';

type Item = Wire<AdminCollectedEvent>;

/** Поля, которые модератор правит перед решением; значения формы — строки, пустая — «нет значения». */
export const DRAFT_FIELDS = ['title', 'starts_at', 'ends_at', 'place', 'address', 'price', 'topic', 'telegram_username', 'whatsapp_phone', 'url', 'description'] as const;
export type Draft = Record<(typeof DRAFT_FIELDS)[number], string>;

// Время события хранится с поясом города (2026-11-20T19:00:00+07:00). В форме — часы по тому же поясу: просто отрезаем
// хвост, а при сохранении приклеиваем пояс обратно; браузерный пояс модератора тут ни при чём.
const local = (iso: string) => iso.slice(0, 16);
const offset = (iso: string) => iso.slice(19).replace(/^\.\d+/, ''); // '+07:00' или 'Z'
export const toIso = (value: string, like: string) => `${value}:00${offset(like)}`;

export function draftOf(e: Item): Draft {
  return {
    title: e.title, description: e.description, starts_at: local(e.starts_at), ends_at: e.ends_at ? local(e.ends_at) : '',
    place: e.place ?? '', address: e.address ?? '', price: e.price ?? '', topic: e.topic ?? '',
    telegram_username: e.telegram_username ?? '', whatsapp_phone: e.whatsapp_phone ?? '', url: e.url ?? '',
  };
}

/** Только изменённые поля, в форме запроса: пустое — null, время — с поясом события. */
export function changesOf(e: Item, draft: Draft): CollectedUpdateInput {
  const was = draftOf(e);
  const out: Record<string, unknown> = {};
  for (const k of DRAFT_FIELDS) {
    const v = draft[k].trim();
    if (v === was[k].trim()) continue;
    if (k === 'title' || k === 'description') out[k] = v;
    else if (k === 'starts_at') out[k] = toIso(v, e.starts_at);
    else if (k === 'ends_at') out[k] = v ? toIso(v, e.ends_at ?? e.starts_at) : null;
    else if (k === 'topic') { if (v) out[k] = v; } // темы «нет» не бывает: пустое значит «не трогать»
    else out[k] = v || null;
  }
  return out as CollectedUpdateInput;
}
