// Лента «Активности»: строка — кто, что сделал, куда, откуда пришёл и когда. Её показывают раздел «Активность» и карточка человека.
import type { ActivityType, AdminActivityEntry, Wire } from '@yaswami/core';
import type { LucideIcon } from 'lucide-react';
import { EyeIcon, HandIcon, TicketIcon, UserPlusIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { EntityLink } from '@/components/EntityLink';
import { when } from '@/components/History';
import { Badge } from '@/components/ui/badge';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { ACTIVITY_LABELS, ago, JOINED_VIA_LABELS, startParts } from '@/lib/activity';

type Entry = Wire<AdminActivityEntry>;

const ICONS: Record<ActivityType, LucideIcon> = {
  user_joined: UserPlusIcon, guest_registered: TicketIcon, collected_signup: TicketIcon, practice_signup: HandIcon, visit: EyeIcon,
};

/** Откуда пришёл: через что и по какой ссылке — событие, кто позвал, метка. */
export function Arrival({ via, start }: { via: Entry['joined_via']; start: string | null }) {
  const { event, ref, tag, other } = startParts(start);
  const parts: ReactNode[] = [
    via ? JOINED_VIA_LABELS[via] : 'откуда — неизвестно',
    event && <>по ссылке на <EntityLink entity={event.entity} id={event.id}>событие</EntityLink></>,
    ref && <>позвал <EntityLink entity="user" id={ref}>id {ref}</EntityLink></>,
    tag && <>метка <Badge variant="outline">{tag}</Badge></>,
    other && <>ссылка <Badge variant="outline">{other}</Badge></>,
  ].filter(Boolean);
  return <>{parts.map((p, i) => <span key={i}>{i > 0 && ' · '}{p}</span>)}</>;
}

/** Когда: «12 мин назад», точное время — в подсказке при наведении. */
export const Ago = ({ at }: { at: string }) => <span className="text-muted-foreground whitespace-nowrap" title={when(at)}>{ago(at)}</span>;

function Row({ e, showUser }: { e: Entry; showUser: boolean }) {
  const Icon = ICONS[e.type];
  return (
    <Item size="xs" variant="muted">
      <ItemMedia variant="icon"><Icon /></ItemMedia>
      <ItemContent>
        <ItemTitle className="flex-wrap">
          {showUser && <EntityLink entity="user" id={e.user.id}>{e.user.first_name}</EntityLink>}
          <span className="font-normal text-muted-foreground">{ACTIVITY_LABELS[e.type]}</span>
          {e.target && <EntityLink entity={e.target.entity} id={e.target.id}>{e.target.name}</EntityLink>}
        </ItemTitle>
        {e.type === 'user_joined' && <ItemDescription><Arrival via={e.joined_via} start={e.start_param} /></ItemDescription>}
        {e.referrer && <ItemDescription>по ссылке <EntityLink entity="user" id={e.referrer.id}>{e.referrer.first_name}</EntityLink></ItemDescription>}
      </ItemContent>
      <ItemActions><Ago at={e.created_at} /></ItemActions>
    </Item>
  );
}

export function ActivityFeed({ entries, showUser = true }: { entries: Entry[]; showUser?: boolean }) {
  return (
    <ItemGroup className="gap-1">
      {entries.map((e, i) => <Row key={`${e.type}:${e.user.id}:${e.target?.id ?? ''}:${e.created_at}:${i}`} e={e} showUser={showUser} />)}
    </ItemGroup>
  );
}
