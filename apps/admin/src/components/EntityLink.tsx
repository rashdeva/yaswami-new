// Ссылка на карточку сущности. Адреса знают только router.tsx и это место (через entityLink в lib/journal.ts).
import { Link } from '@tanstack/react-router';
import type { AdminEntity } from '@yaswami/core';
import type { ReactNode } from 'react';
import { entityLink } from '@/lib/journal';

export function EntityLink({ entity, id, children }: { entity: AdminEntity; id: string | number; children: ReactNode }) {
  const to = entityLink(entity, String(id));
  if (!to) return <>{children}</>;
  return <Link className="underline underline-offset-2" {...to}>{children}</Link>;
}

/** Ссылка на запись журнала. */
export const ActionLink = ({ id, children }: { id: string; children: ReactNode }) => (
  <Link className="underline underline-offset-2" to="/actions/$id" params={{ id }}>{children}</Link>
);
