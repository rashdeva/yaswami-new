// Ссылки: на карточку сущности, на запись журнала и наружу. Адреса карточек знают только router.tsx и это место (через entityLink в lib/journal.ts).
// Вид ссылки задан здесь один раз — экраны своих классов для ссылок не пишут.
import { Link } from '@tanstack/react-router';
import type { AdminEntity } from '@yaswami/core';
import { instagramOf } from '@yaswami/core';
import { ExternalLinkIcon, SendIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { sourceLink, sourceName } from '@/lib/catalog';
import { entityLink } from '@/lib/journal';

const LINK = 'underline underline-offset-4 hover:text-primary';

export function EntityLink({ entity, id, children }: { entity: AdminEntity; id: string | number; children: ReactNode }) {
  const to = entityLink(entity, String(id));
  if (!to) return <>{children}</>;
  return <Link className={LINK} {...to}>{children}</Link>;
}

/** Ссылка на запись журнала. */
export const ActionLink = ({ id, children }: { id: string; children: ReactNode }) => (
  <Link className={LINK} to="/actions/$id" params={{ id }}>{children}</Link>
);

/** Ссылка наружу — в Telegram, на анонс, на сайт: в новой вкладке, `icon` — со значком. */
export const ExternalLink = ({ href, icon, children }: { href: string; icon?: boolean; children: ReactNode }) => (
  <a className={`${LINK} inline-flex items-center gap-1`} href={href} target="_blank" rel="noreferrer">{icon && <ExternalLinkIcon className="size-3.5" />}{children}</a>
);

/** Действия человека в мини-приложении и на сайте: в PostHog он записан под своим id пользователя (apps/web/src/analytics.ts). */
export const PostHogLink = ({ userId }: { userId: number }) => <ExternalLink icon href={`https://us.posthog.com/project/188112/person/${userId}`}>PostHog</ExternalLink>;

/** Значок Instagram: в lucide-react 1.x значков брендов нет, рисуем в его стиле (контур 2px, currentColor). */
const InstagramIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h.01" />
  </svg>
);

/** Значок площадки: Instagram или Telegram (бумажный самолётик). */
export const PlatformIcon = ({ instagram }: { instagram: boolean }) => instagram
  ? <InstagramIcon className="size-3.5 shrink-0" />
  : <SendIcon className="size-3.5 shrink-0" />;

/** Профиль в Telegram по username. */
export const TelegramLink = ({ username }: { username: string }) => (
  <ExternalLink href={`https://t.me/${username}`}><PlatformIcon instagram={false} />@{username}</ExternalLink>
);

/** Профиль в Instagram по нику. */
export const InstagramLink = ({ handle }: { handle: string }) => (
  <ExternalLink href={`https://instagram.com/${handle}`}><PlatformIcon instagram />@{handle}</ExternalLink>
);

/** Источник со значком площадки: канал Telegram или профиль Instagram. `href` — куда вести (анонс), иначе — сам источник. */
export function SourceLink({ channel, href }: { channel: string; href?: string }) {
  const url = href ?? sourceLink(channel);
  const label = <><PlatformIcon instagram={!!instagramOf(channel)} />{sourceName(channel)}</>;
  return url ? <ExternalLink href={url}>{label}</ExternalLink> : <span className="inline-flex items-center gap-1">{label}</span>;
}
