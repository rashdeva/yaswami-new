// Чистые функции каталога: подписи статусов, контакт для записи из ссылки «Записаться», события организатора.
import type { AdminCollectedEvent, CollectedStatus, Feature, Guest, HostStatus, PracticeStatus } from '@yaswami/core';
import { OTHER_TOPIC, TOPIC_GUIDES } from '@yaswami/core';

/** Модерация организатора (HOST_STATUSES в core). */
export const HOST_LABELS: Record<HostStatus, string> = { pending: 'Новый', published: 'Проверен', rejected: 'Отклонён' };

export const PRACTICE_LABELS: Record<PracticeStatus, string> = { pending: 'Ждёт решения', published: 'Опубликована', rejected: 'Отклонена' };

export const COLLECTED_LABELS: Record<CollectedStatus, string> = {
  pending: 'Ждёт решения',
  approved: 'Обрабатывается',
  published: 'В ленте',
  rejected: 'Отклонено',
};

export const EVENT_STATUS_LABELS = { draft: 'Черновик', published: 'Опубликовано', cancelled: 'Отменено' } as const;

/** Возможности, которые команда включает человеку лично. */
export const FEATURE_LABELS: Record<Feature, string> = { event_create: 'Создавать события (организатор)' };

export const APPROVAL_LABELS: Record<Guest['approval_status'], string> = { approved: 'Пойдёт', maybe: 'Думает', declined: 'Не пойдёт', waitlist: 'Лист ожидания' };

/**
 * Контакт для записи, который виден по `signup_url`: сервер отдаёт только эту ссылку, а сами поля
 * (`telegram_username`, `whatsapp_phone`, `url`) — нет. Видно лишь то, что в ссылке главное; остальное — пусто.
 */
export function contactOf(e: Pick<AdminCollectedEvent, 'signup_url' | 'source_url'>) {
  const tg = /^https:\/\/t\.me\/(\w{4,32})\?text=/.exec(e.signup_url)?.[1] ?? null;
  const wa = /^https:\/\/wa\.me\/(\d+)\?text=/.exec(e.signup_url)?.[1] ?? null;
  const url = !tg && !wa && e.signup_url !== e.source_url ? e.signup_url : null;
  return { telegram_username: tg, whatsapp_phone: wa && `+${wa}`, url };
}

/** События каталога организатора: контакт для записи — его username, или анонс из его канала. */
export function hostEvents<T extends Pick<AdminCollectedEvent, 'signup_url' | 'source_url' | 'channel'>>(host: { username: string; channel: string | null }, items: T[]) {
  const username = host.username.toLowerCase();
  const channel = host.channel?.toLowerCase();
  return items.filter((e) => contactOf(e).telegram_username?.toLowerCase() === username || (!!channel && e.channel.toLowerCase() === channel));
}

/** Поиск по названию, месту и источнику. */
export const matchCollected = (e: Pick<AdminCollectedEvent, 'title' | 'place' | 'channel'>, query: string) => {
  const q = query.trim().toLowerCase();
  return !q || [e.title, e.place, e.channel].some((s) => s?.toLowerCase().includes(q));
};

/** Темы для выбора: справочник и «другое»; тема события, которой нет в справочнике, тоже остаётся в списке. */
export const topicOptions = (current?: string | null) =>
  [...new Set([...Object.keys(TOPIC_GUIDES), OTHER_TOPIC, ...(current ? [current] : [])])]
    .map((t) => [t, TOPIC_GUIDES[t] ? `${TOPIC_GUIDES[t].emoji} ${t}` : t] as const);
