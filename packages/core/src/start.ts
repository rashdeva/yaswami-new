// Разбор ссылки, с которой открыли приложение: t.me/<бот>/<приложение>?startapp=<параметр> (в браузере — ?startapp=)
// или пришли к боту: t.me/<бот>?start=<параметр>. Его же команда видит в приходе человека (CONTEXT.md, «Приход»).
// Формат: <id события>[-r<кто позвал>][-s<метка>]; любая часть может отсутствовать. Telegram пускает в параметр только A-Z a-z 0-9 _ -.

export interface Start {
  /** Событие, которое нужно открыть: `e_…` — событие Ясвами, `c_…` — собранное. */
  param?: string;
  /** id пользователя, по чьей ссылке пришли: хвост `-r<id>` дописывает «Поделиться» (format.ts, eventLink). */
  ref?: number;
  /** Метка источника для аналитики: хвост `-s<метка>` дописывают руками в ссылку для поста или рекламы. Буквы, цифры и `_`. */
  tag?: string;
}

export function parseStart(raw: string | undefined): Start {
  // id событий дефисом с буквой не заканчиваются (`e_<hex>`, `c_<канал>-<номер>-<индекс>`), поэтому хвосты отделяются однозначно.
  // До перехода на случайные id (ADR-0008) id бывал отрицательным: `-r-5` — такие ссылки уже разосланы.
  const m = /^(.*?)(?:-r(-?\d+))?(?:-s([A-Za-z0-9_]+))?$/.exec(raw ?? '');
  return { param: m?.[1] || undefined, ref: m?.[2] ? Number(m[2]) : undefined, tag: m?.[3] };
}

/**
 * С какой ссылкой человек пришёл на сайт — для его прихода при входе: `?startapp=…` как есть, а без него
 * `?utm_source=<метка>` становится меткой `-s<метка>` (ссылки из Instagram и рекламы обычно с utm). Метка — только
 * буквы, цифры и `_`, как в startapp; иначе — ничего.
 */
export function siteStart(search: string): string | undefined {
  const params = new URLSearchParams(search);
  const startapp = params.get('startapp');
  if (startapp && /^[\w-]{1,64}$/.test(startapp)) return startapp;
  const utm = params.get('utm_source')?.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60);
  return utm ? `-s${utm}` : undefined;
}

// --- Намерение: зачем человек открывает бота (в Luma такого нет). Форм у нас нет — добавить событие, товар или услугу
// и оставить отзыв можно только в переписке с ботом. Кнопка в приложении открывает бота ссылкой с параметром
// (`t.me/<бот>?start=<намерение>`), и бот сразу спрашивает нужное, а не здоровается. Один механизм на все такие
// кнопки: новое намерение — вариант в `BotIntent`, его запись в `botIntentParam` / `parseBotIntent` и ответ бота в `bot.ts`.

/** Что можно добавить через бота. Порядок — порядок плашек на экране «Добавить». */
export const ADD_KINDS = ['event', 'product', 'service'] as const;
export type AddKind = (typeof ADD_KINDS)[number];

export type BotIntent =
  | { type: 'add'; kind: AddKind } // добавить своё событие, товар или услугу
  | { type: 'feedback'; host_id: string }; // оставить отзыв о мастере (ссылку даёт сам мастер)

/** Намерение как параметр `start`: `add_<что>` или `fb_<id мастера без дефисов>` — Telegram пускает только A-Z a-z 0-9 _ -. */
export const botIntentParam = (intent: BotIntent): string =>
  intent.type === 'add' ? `add_${intent.kind}` : `fb_${intent.host_id.replaceAll('-', '')}`;

/** Ссылка, которая открывает бота с намерением. */
export const botIntentUrl = (botUsername: string, intent: BotIntent): string => `https://t.me/${botUsername}?start=${botIntentParam(intent)}`;

/** Намерение из параметра `start` (без хвостов `-r…`, `-s…`: их снимает `parseStart`). null — параметр не про намерение. */
export function parseBotIntent(param: string | undefined): BotIntent | null {
  const add = /^add_(\w+)$/.exec(param ?? '')?.[1];
  if (add) return (ADD_KINDS as readonly string[]).includes(add) ? { type: 'add', kind: add as AddKind } : null;
  const host = /^fb_([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i.exec(param ?? '');
  return host ? { type: 'feedback', host_id: host.slice(1).join('-').toLowerCase() } : null;
}
