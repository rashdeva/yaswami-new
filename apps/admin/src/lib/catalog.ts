// Чистые функции каталога: подписи статусов, контакт для записи из ссылки «Записаться», события организатора.
import type { AdminCollectedEvent, CollectedStatus, Feature, Guest, HostStatus, IdentityProvider, JobStatus, PracticeStatus } from '@yaswami/core';
import { instagramOf, JOB_TTL_DAYS, OTHER_TOPIC, TOPIC_GUIDES } from '@yaswami/core';

/** Ссылка на источник: профиль Instagram или канал в Telegram; у закрытого чата (-100…) ссылки нет. */
export function sourceLink(channel: string): string | null {
  const ig = instagramOf(channel);
  return ig ? `https://instagram.com/${ig}` : channel.startsWith('-') ? null : `https://t.me/${channel}`;
}
/** Как источник подписан: «@канал» или «@ник» (площадку показывает значок, в тексте — sourcePlatform), id закрытого чата — как есть. */
export function sourceName(channel: string): string {
  const ig = instagramOf(channel);
  return ig ? `@${ig}` : channel.startsWith('-') ? channel : `@${channel}`;
}
/** Источник одной строкой, где значка нет (подзаголовки, подсказки): «Instagram @ник» или «Telegram @канал». */
export const sourcePlatform = (channel: string): string => `${instagramOf(channel) ? 'Instagram' : 'Telegram'} ${sourceName(channel)}`;

/** Модерация организатора (HOST_STATUSES в core). */
/** Способы входа человека (user_identities, ADR-0008). */
export const IDENTITY_LABELS: Record<IdentityProvider, string> = { telegram: 'Telegram', apple: 'Apple', google: 'Google' };

export const HOST_LABELS: Record<HostStatus, string> = { pending: 'Новый', published: 'Проверен', rejected: 'Отклонён' };

/**
 * Кто перед нами в «Мастерах»: у организатора есть предстоящие события в каталоге, у мастера — только Practice,
 * у остальных нет ни того, ни другого — чаще всего это случайный человек из чата, а не организатор.
 */
export type HostKind = 'events' | 'services' | 'none';
export const HOST_KINDS: Record<HostKind, string> = { events: 'Организаторы', services: 'Мастера', none: 'Без событий и услуг' };
export const hostKind = (events: number, practices: number): HostKind => (events > 0 ? 'events' : practices > 0 ? 'services' : 'none');

export const PRACTICE_LABELS: Record<PracticeStatus, string> = { pending: 'Ждёт решения', published: 'Опубликована', rejected: 'Отклонена' };

export const JOB_LABELS: Record<JobStatus, string> = { pending: 'Ждёт решения', published: 'Опубликована', rejected: 'Отклонена' };

/** Объявление старше JOB_TTL_DAYS дней: гостям вакансия уже не показывается, даже одобренная (liveJob в apps/api/src/services.ts). */
export const jobExpired = (posted_at: string, now = Date.now()) => now - Date.parse(posted_at) >= JOB_TTL_DAYS * 86_400_000;

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
 * (`telegram_username`, `whatsapp_phone`, `instagram_username`, `url`) — нет. Видно лишь то, что в ссылке главное; остальное — пусто.
 */
export function contactOf(e: Pick<AdminCollectedEvent, 'signup_url' | 'source_url'>) {
  const tg = /^https:\/\/t\.me\/(\w{4,32})\?text=/.exec(e.signup_url)?.[1] ?? null;
  const wa = /^https:\/\/wa\.me\/(\d+)\?text=/.exec(e.signup_url)?.[1] ?? null;
  const ig = /^https:\/\/ig\.me\/m\/([\w.]+)$/.exec(e.signup_url)?.[1] ?? null;
  const url = !tg && !wa && !ig && e.signup_url !== e.source_url ? e.signup_url : null;
  return { telegram_username: tg, whatsapp_phone: wa && `+${wa}`, instagram_username: ig, url };
}

/** События каталога организатора: контакт для записи — его username, или анонс из его канала или его Instagram. */
export function hostEvents<T extends Pick<AdminCollectedEvent, 'signup_url' | 'source_url' | 'channel'>>(host: { username: string; channel: string | null; instagram_handle?: string | null }, items: T[]) {
  const username = host.username.toLowerCase();
  const channel = host.channel?.toLowerCase();
  const instagram = host.instagram_handle?.toLowerCase();
  return items.filter((e) => contactOf(e).telegram_username?.toLowerCase() === username || (!!channel && e.channel.toLowerCase() === channel)
    || (!!instagram && instagramOf(e.channel.toLowerCase()) === instagram));
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
