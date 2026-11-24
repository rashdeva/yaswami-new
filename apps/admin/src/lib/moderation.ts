// Очередь модерации «Ленты»: всё, что ждёт решения команды, — события каталога, услуги, мастера и вакансии —
// одним списком строк, и решения по ним теми же вызовами, что на родных экранах.
import type { AdminCollectedEvent, AdminEntity, AdminHostListItem, Job, Wire } from '@yaswami/core';
import { collectedWhen } from '@yaswami/core';
import { sourcePlatform } from './catalog.ts';

export type ModerationKind = 'event' | 'service' | 'host' | 'job';
export type Decision = 'approve' | 'reject';

/** Строка очереди: один вид для всех четырёх сущностей. */
export interface ModerationRow {
  kind: ModerationKind;
  id: string;
  /** Ключ выбора и строки списка: id разных сущностей могут совпасть. */
  key: string;
  title: string;
  subtitle: string;
  /** Куда ведёт название: карточка события или мастера, вкладка вакансий. */
  link: { entity: AdminEntity; id: string };
  /** Анонс или объявление, из которого сущность собрана. */
  url?: string;
  /** Мастер услуги: по нему находится строка журнала для отмены. */
  host_id?: string;
}

export interface ModerationGroup { kind: ModerationKind; label: string; rows: ModerationRow[] }

const LABELS: Record<ModerationKind, string> = { event: 'События', service: 'Услуги', host: 'Мастера', job: 'Вакансии' };

const line = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const day = (iso: string) => new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'short' });

interface Sources {
  /** Предстоящие события каталога любого статуса. */
  events?: Pick<AdminCollectedEvent, 'id' | 'title' | 'starts_at' | 'channel' | 'source_url' | 'status'>[];
  hosts?: Pick<Wire<AdminHostListItem>, 'id' | 'name' | 'username' | 'status' | 'created_at' | 'practices'>[];
  jobs?: Pick<Wire<Job>, 'id' | 'title' | 'employer' | 'pay' | 'posted_at' | 'announcement' | 'status'>[];
  /** Сколько предстоящих событий у мастера, по username (сводка «Мастеров»). */
  hostEvents?: Map<string, number>;
}

/** Четыре очереди «ждут решения»; пустых групп нет. Отбор тот же, что на вкладках «Ждёт решения» родных экранов. */
export function moderationQueue({ events = [], hosts = [], jobs = [], hostEvents }: Sources): ModerationGroup[] {
  const row = (kind: ModerationKind, id: string, rest: Omit<ModerationRow, 'kind' | 'id' | 'key'>): ModerationRow => ({ kind, id, key: `${kind}:${id}`, ...rest });
  const groups: Record<ModerationKind, ModerationRow[]> = {
    event: events.filter((e) => e.status === 'pending').map((e) =>
      row('event', e.id, { title: e.title, subtitle: line([collectedWhen(e.starts_at), sourcePlatform(e.channel)]), link: { entity: 'collected_event', id: e.id }, url: e.source_url })),
    service: hosts.flatMap((h) => h.practices.filter((p) => p.status === 'pending').map((p) =>
      row('service', p.id, { title: p.title, subtitle: line([h.name, p.topic, p.price ?? 'цена по запросу']), link: { entity: 'host', id: h.id }, host_id: h.id }))),
    host: hosts.filter((h) => h.status === 'pending').sort((a, b) => b.created_at.localeCompare(a.created_at)).map((h) =>
      row('host', h.id, { title: h.name, subtitle: line([`@${h.username}`, `услуг: ${h.practices.length}`, `событий: ${hostEvents?.get(h.username) ?? 0}`]), link: { entity: 'host', id: h.id } })),
    job: jobs.filter((j) => j.status === 'pending').map((j) =>
      row('job', j.id, { title: j.title, subtitle: line([j.employer ?? 'наниматель не назвался', j.pay ?? 'оплата не указана', day(j.posted_at)]), link: { entity: 'job', id: j.id }, url: j.announcement.url })),
  };
  return (Object.keys(LABELS) as ModerationKind[]).filter((k) => groups[k].length).map((kind) => ({ kind, label: LABELS[kind], rows: groups[kind] }));
}

export const moderationTotal = (groups: ModerationGroup[]) => groups.reduce((n, g) => n + g.rows.length, 0);

/** Вызов решения: вход — ровно тот, что шлёт кнопка родного экрана (`CatalogScreen`, `CatalogServicesScreen`, `HostsScreen`, `CatalogJobsScreen`). */
export type DecisionCall =
  | { kind: 'event'; input: { id: string; input: { status: 'approved' | 'rejected' } } }
  | { kind: 'service'; input: { host_id: string; practice_id: string; status: 'published' | 'rejected' } }
  | { kind: 'host'; input: { id: string; status: 'published' | 'rejected' } }
  | { kind: 'job'; input: { id: string; input: { status: 'published' | 'rejected' } } };

export function decisionCall(row: ModerationRow, decision: Decision): DecisionCall {
  const status = decision === 'approve' ? 'published' : 'rejected';
  switch (row.kind) {
    // Одобренное событие сначала проходит обработку (обложка и ролик) и публикуется само.
    case 'event': return { kind: 'event', input: { id: row.id, input: { status: decision === 'approve' ? 'approved' : 'rejected' } } };
    case 'service': return { kind: 'service', input: { host_id: row.host_id!, practice_id: row.id, status } };
    case 'host': return { kind: 'host', input: { id: row.id, status } };
    case 'job': return { kind: 'job', input: { id: row.id, input: { status } } };
  }
}

/** План пачки: выбранные строки в порядке очереди — по вызову на строку. Выбранное, чего в очереди уже нет, пропускается. */
export const batchPlan = (groups: ModerationGroup[], selected: ReadonlySet<string>, decision: Decision) =>
  groups.flatMap((g) => g.rows).filter((r) => selected.has(r.key)).map((row) => ({ row, call: decisionCall(row, decision) }));

/** Итог пачки одной строкой для тоста. */
export const batchSummary = (decision: Decision, ok: number, failed: number) =>
  `${decision === 'approve' ? 'Одобрено' : 'Отклонено'}: ${ok}` + (failed ? `. Не получилось: ${failed} — они остались выбранными.` : '');
