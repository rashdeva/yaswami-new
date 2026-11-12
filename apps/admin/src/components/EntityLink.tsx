// Ссылки: на карточку сущности, на запись журнала и наружу. Адреса карточек знают только router.tsx и это место (через entityLink в lib/journal.ts).
// Вид ссылки задан здесь один раз — экраны своих классов для ссылок не пишут.
import { Link } from '@tanstack/react-router';
import type { AdminEntity } from '@yaswami/core';
import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
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

/** Профиль в Telegram по username. */
export const TelegramLink = ({ username }: { username: string }) => <ExternalLink href={`https://t.me/${username}`}>@{username}</ExternalLink>;
