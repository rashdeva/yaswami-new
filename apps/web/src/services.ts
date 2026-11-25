// Вкладка «Услуги» без React: услуги мастеров одним списком, разложенные по направлениям, и порядок находок поиска.
import type { HostListItem, Practice, PracticeFormat, SearchEntry, TopicItem, Wire } from '@yaswami/core';
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

/** Ключи сквозных разделов: собраны не по теме, а по разбору услуги. Адрес раздела — как у направлений. */
export const WORKSHOPS = 'workshops';
export const KIDS = 'kids'; // совпадает со slug направления «Детям»: сквозной раздел шире и заменяет его
export const CHEAP = 'cheap';

const isKids = (item: ServiceItem, topics: TopicItem[]) =>
  !!item.practice.for_kids || topics.some((t) => t.direction === 'kids' && t.name === item.practice.topic);

/**
 * Сквозные разделы для плиток: «Мастер-классы» (формат workshop) и «Детям» (для детей или тема направления «Детям»).
 * Пустых нет. `topic` — тема для иконки.
 */
export function serviceShortcuts(items: ServiceItem[], topics: TopicItem[]): ServiceGroup[] {
  return [
    { key: WORKSHOPS, name: 'Мастер-классы', topic: 'творчество', items: items.filter((i) => i.practice.formats?.includes('workshop')) },
    { key: KIDS, name: 'Детям', topic: 'детям', items: items.filter((i) => isKids(i, topics)) },
  ].filter((g) => g.items.length);
}

/**
 * Цена числом есть. Через typeof, а не `!== null`: API без полей разбора (выкладка идёт, старая версия) отдаёт undefined.
 */
export const hasAmount = (p: Pick<Practice, 'price_amount'>): p is Pick<Practice, 'price_amount'> & { price_amount: number } => typeof p.price_amount === 'number';

/**
 * «Попробовать недорого»: самые дешёвые услуги в валюте, в которой цен больше всего (в городе обычно одна, а сравнивать
 * донги с долларами незачем), бесплатные — в любой валюте. Меньше трёх с ценой — раздела нет: сравнивать не с чем.
 */
export function cheapest(items: ServiceItem[], limit: number): ServiceItem[] {
  const priced = items.filter((i) => hasAmount(i.practice));
  const counts = new Map<string | null, number>();
  for (const i of priced) counts.set(i.practice.price_currency, (counts.get(i.practice.price_currency) ?? 0) + 1);
  const currency = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const same = priced.filter((i) => i.practice.price_amount === 0 || i.practice.price_currency === currency);
  return same.length < 3 ? [] : same.sort((a, b) => a.practice.price_amount! - b.practice.price_amount!).slice(0, limit);
}

/** Фильтр раздела: формат услуги или «С ценой». */
export type ServiceFilter = PracticeFormat | 'priced';
export const FILTER_LABELS: Record<ServiceFilter, string> = { personal: 'Лично', group: 'В группе', online: 'Онлайн', workshop: 'Мастер-класс', priced: 'С ценой' };
const FILTERS = Object.keys(FILTER_LABELS) as ServiceFilter[];

export const matchesFilter = (item: ServiceItem, filter: ServiceFilter) =>
  filter === 'priced' ? hasAmount(item.practice) : !!item.practice.formats?.includes(filter);

/** Фильтры, которые что-то меняют: есть услуги и с ним, и без него. */
export const usefulFilters = (items: ServiceItem[]) => FILTERS.filter((f) => {
  const n = items.filter((i) => matchesFilter(i, f)).length;
  return n > 0 && n < items.length;
});

const FORMAT_WORDS: Record<PracticeFormat, string> = { personal: 'лично', group: 'группа', online: 'онлайн', workshop: 'мастер-класс' };
/** Формат одной строкой: «лично, онлайн». Не разобрана или не понять — пусто. */
export const formatLabel = (p: Pick<Practice, 'formats'>) => (p.formats ?? []).map((f) => FORMAT_WORDS[f]).join(', ');

const SIGNS: Record<string, (n: string) => string> = { VND: (n) => `${n} ₫`, USD: (n) => `$${n}`, EUR: (n) => `€${n}`, RUB: (n) => `${n} ₽`, GEL: (n) => `${n} ₾`, LKR: (n) => `Rs ${n}` };
/** Сумма коротко, как пишут в городе: 150 000 донгов — «150k ₫», 1 200 000 — «1,2 млн ₫», 30 долларов — «$30». */
export function money(amount: number, currency: string | null): string {
  if (amount === 0) return 'бесплатно';
  const n = amount >= 1_000_000 ? `${(amount / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн`
    : amount >= 10_000 && amount % 1000 === 0 ? `${amount / 1000}k`
    : amount.toLocaleString('ru-RU');
  const sign = currency ? SIGNS[currency] : undefined;
  return sign ? sign(n) : currency ? `${n} ${currency}` : n;
}

/** Цена услуги для списка: числом в одном виде, если сборщик её разобрал; иначе как написал мастер. */
export const practicePrice = (p: Pick<Practice, 'price' | 'price_amount' | 'price_currency'>) =>
  hasAmount(p) ? money(p.price_amount, p.price_currency ?? null) : p.price ?? 'цена по запросу';

/** Находки поиска разделами: сначала тип вкладки (`first`), за ним остальные; внутри — порядок поиска (лучшие первыми). */
export function searchSections(entries: Wire<SearchEntry>[], first: SearchEntry['type']) {
  const order: SearchEntry['type'][] = [first, ...(['practice', 'event', 'product'] as const).filter((t) => t !== first)];
  return order.map((type) => ({ type, entries: entries.filter((e) => e.type === type) })).filter((s) => s.entries.length);
}
