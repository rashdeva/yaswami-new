// Вкладка «Услуги» без React: услуги мастеров одним списком, разложенные по направлениям, и порядок находок поиска.
import type { HostListItem, Practice, SearchEntry, TopicItem, Wire } from '@yaswami/core';
import { topicsByDirection } from '@yaswami/core';

/** Услуга (Practice без Session, CONTEXT.md) вместе с мастером — так её показывает вкладка. */
export interface ServiceItem { practice: Practice; host: HostListItem }

/** Раздел вкладки: направление или тема без направления. `topic` — по нему иконка раздела; `key` — адрес раздела. */
export interface ServiceGroup { key: string; name: string; topic: string | null; items: ServiceItem[] }

/** Ключ раздела для темы, которой нет в списке тем (ещё не пришёл или тему убрали): всё такое — в «Другом». */
export const OTHER_GROUP = 'other';

const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * Услуги, разложенные по направлениям в порядке DIRECTIONS — как плитки на витрине событий. Тема без направления —
 * своим разделом; услуга с неизвестной темой — в «Другом» в конце. Пустых разделов нет. Внутри — сначала первая
 * услуга каждого мастера в порядке каталога, потом вторые и дальше: первые строки раздела — разные мастера.
 */
export function serviceGroups(hosts: HostListItem[], topics: TopicItem[]): ServiceGroup[] {
  const items = hosts
    .flatMap((host) => host.practices.map((practice, rank) => ({ practice, host, rank })))
    .sort((a, b) => a.rank - b.rank) // сортировка устойчивая: при равном rank остаётся порядок каталога
    .map(({ practice, host }) => ({ practice, host }));
  const used = topics.filter((t) => items.some((i) => i.practice.topic === t.name));
  const groups = topicsByDirection(used).map(({ direction, topics: inside }) => ({
    key: direction?.slug ?? inside[0]!.slug,
    name: direction?.name ?? capital(inside[0]!.name),
    topic: inside[0]!.name,
    items: items.filter((i) => inside.some((t) => t.name === i.practice.topic)),
  }));
  const rest = items.filter((i) => !used.some((t) => t.name === i.practice.topic));
  return rest.length ? [...groups, { key: OTHER_GROUP, name: 'Другое', topic: null, items: rest }] : groups;
}

/** Находки поиска разделами: сначала тип вкладки (`first`), за ним остальные; внутри — порядок поиска (лучшие первыми). */
export function searchSections(entries: Wire<SearchEntry>[], first: SearchEntry['type']) {
  const order: SearchEntry['type'][] = [first, ...(['practice', 'event', 'product'] as const).filter((t) => t !== first)];
  return order.map((type) => ({ type, entries: entries.filter((e) => e.type === type) })).filter((s) => s.entries.length);
}
