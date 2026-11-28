// Видимость события глазами организатора (ADR-0014): что сказать ему о том, где событие сейчас видно.
// Чистая логика — экран только рисует результат.
import type { Event, Wire } from '@yaswami/core';

export type ShowcaseTone = 'on' | 'wait' | 'off' | 'no';
export interface ShowcaseState {
  /** Переключатель «в афише города» включён: организатор хочет, чтобы событие видели все. */
  wanted: boolean;
  tone: ShowcaseTone;
  badge: string;
  note: string;
}

type Shown = Pick<Wire<Event>, 'visibility' | 'status' | 'showcase_status'>;

/** Где событие видно прямо сейчас и что с этим делать. */
export function showcaseState({ visibility, status, showcase_status }: Shown): ShowcaseState {
  if (visibility !== 'public') {
    return { wanted: false, tone: 'off', badge: 'Только по ссылке', note: 'Событие видят только те, у кого есть ссылка. В афише и поиске его нет.' };
  }
  if (status === 'cancelled') return { wanted: true, tone: 'off', badge: 'Отменено', note: 'Отменённое событие в афише не показывается.' };
  if (status === 'draft') return { wanted: true, tone: 'wait', badge: 'Черновик', note: 'Событие попросится в афишу, когда вы его опубликуете.' };
  if (showcase_status === 'published') return { wanted: true, tone: 'on', badge: 'В афише', note: 'Событие видят все в городе: оно в афише и в поиске.' };
  if (showcase_status === 'rejected') {
    return { wanted: true, tone: 'no', badge: 'Не в афише', note: 'Команда не взяла событие в афишу. По ссылке оно открывается; если это ошибка — напишите боту.' };
  }
  return { wanted: true, tone: 'wait', badge: 'На проверке', note: 'Команда смотрит событие, обычно это недолго. Пока оно открывается по ссылке.' };
}

/** Ссылка коротко, без протокола: для строки «скопировать». */
export const shortLink = (link: string) => link.replace(/^https?:\/\//, '');
