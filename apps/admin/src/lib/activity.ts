// Чистые функции «Активности»: подписи, разбор ссылки, с которой человек пришёл, и «когда был». Без React и сети.
import type { ActivityFilter, ActivityType, JoinedVia } from '@yaswami/core';
import { parseStart } from '@yaswami/core';

export const JOINED_VIA_LABELS: Record<JoinedVia, string> = { mini_app: 'мини-приложение', bot: 'бот', site: 'сайт', mobile_app: 'приложение' };

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  user_joined: 'пришёл',
  guest_registered: 'ответил на событие',
  collected_signup: 'записался на событие',
  practice_signup: 'записался на услугу',
  visit: 'открыл событие',
};

/** Вкладки ленты: `all` — без отбора. */
export const ACTIVITY_TABS: [ActivityFilter | 'all', string][] = [['all', 'Всё'], ['user_joined', 'Новые'], ['signup', 'Записи'], ['visit', 'Заходы']];

export interface StartParts {
  /** Событие, с которым открыли приложение: Ясвами (`e_…`) или собранное (`c_<id каталога>`). */
  event: { entity: 'event' | 'collected_event'; id: string } | null;
  /** id пользователя, по чьей ссылке пришёл. */
  ref: number | null;
  /** Метка источника: пост, реклама, партнёр. */
  tag: string | null;
  /** Остальное, что не событие: например, параметр ссылки на бота. */
  other: string | null;
}

/** Ссылка входа по частям (формат — `parseStart` в core). */
export function startParts(start: string | null): StartParts {
  const { param, ref, tag } = parseStart(start ?? undefined);
  const event = param?.startsWith('e_') ? { entity: 'event' as const, id: param }
    : param?.startsWith('c_') ? { entity: 'collected_event' as const, id: param.slice(2) }
    : null;
  return { event, ref: ref ?? null, tag: tag ?? null, other: event ? null : param ?? null };
}

/** Когда это было: «только что», «12 мин назад», «3 ч назад», «вчера», «5 дн. назад», дальше — дата. */
export function ago(iso: string, now = Date.now()): string {
  const min = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} ч назад`;
  const days = Math.floor(min / (24 * 60));
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  const d = new Date(iso);
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }) });
}
