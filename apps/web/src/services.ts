// Вкладка «Услуги» без React: услуги мастеров по категориям услуг (ADR-0012), сквозные разделы, цена и порядок находок поиска.
import type { DirectionSlug, HostListItem, Practice, PracticeFormat, SearchEntry, ServiceCategory, TopicItem, Wire } from '@yaswami/core';
import { SERVICE_CATEGORIES, serviceCategoryBySlug } from '@yaswami/core';
import { categoryIcon } from './icons.ts';

/** Услуга (Practice без Session, CONTEXT.md) вместе с мастером — так её показывает вкладка. */
export interface ServiceItem { practice: Practice; host: HostListItem }

/**
 * Раздел вкладки: категория услуги или сквозной раздел. `key` — адрес раздела, `icon` — его иконка (`categoryIcon`),
 * `tint` — slug темы, в цвет которой шапка раздела (`[data-topic]` в tokens.css).
 */
export interface ServiceGroup { key: string; name: string; icon: string; tint: string; items: ServiceItem[] }

/** Ключ раздела для услуг без категории, чью тему тоже не к чему отнести. */
export const OTHER_GROUP = 'other';

/** Пока услуга не размечена (сборщик доберётся за проход-другой) — категория по направлению её темы. */
const FROM_DIRECTION: Record<DirectionSlug, ServiceCategory> = {
  wellness: 'body', fitness: 'sport', arts: 'classes', games: 'classes', social: 'classes', learning: 'lessons', travel: 'classes', family: 'kids',
  food: 'classes', tech: 'lessons',
};
/** Цвет шапки раздела — цвет похожей темы. */
const TINT: Record<ServiceCategory, string> = {
  beauty: 'dance', body: 'body', sport: 'sport', lessons: 'learn', kids: 'kids', psy: 'psy', home: 'meet', photo: 'cinema', pets: 'yoga', classes: 'art',
};

/** Категория услуги: размеченная сборщиком или командой, иначе — по направлению темы; null — не к чему отнести. */
export function categoryOf(p: Pick<Practice, 'category' | 'topic'>, topics: TopicItem[]): ServiceCategory | null {
  if (serviceCategoryBySlug(p.category)) return p.category;
  const direction = topics.find((t) => t.name === p.topic)?.direction;
  return direction ? FROM_DIRECTION[direction] : null;
}

/**
 * Услуги по категориям в порядке SERVICE_CATEGORIES; не к чему отнести — «Другое» в конце. Пустых разделов нет.
 * Внутри — сначала первая услуга каждого мастера в порядке каталога, потом вторые и дальше: первые строки — разные мастера.
 */
export function serviceGroups(hosts: HostListItem[], topics: TopicItem[]): ServiceGroup[] {
  const items = hosts
    .flatMap((host) => host.practices.map((practice, rank) => ({ practice, host, rank })))
    .sort((a, b) => a.rank - b.rank) // сортировка устойчивая: при равном rank остаётся порядок каталога
    .map(({ practice, host }) => ({ practice, host }));
  const groups = SERVICE_CATEGORIES.map((c) => ({
    key: c.slug as string, name: c.name as string, icon: categoryIcon(c.slug), tint: TINT[c.slug],
    items: items.filter((i) => categoryOf(i.practice, topics) === c.slug),
  }));
  const rest = items.filter((i) => !categoryOf(i.practice, topics));
  return [...groups, { key: OTHER_GROUP, name: 'Другое', icon: categoryIcon(OTHER_GROUP), tint: 'other', items: rest }].filter((g) => g.items.length);
}

/** Ключи сквозных разделов: собраны не по категории, а по разбору услуги. Адрес раздела — как у категорий. */
export const KIDS = 'kids'; // совпадает с категорией «Детям»: сквозной раздел шире и заменяет её
export const CHEAP = 'cheap';

/** «Детям»: категория «Детям» и всё, что размечено «для детей» в других категориях. Нет таких — раздела нет. */
export function serviceShortcuts(items: ServiceItem[], topics: TopicItem[]): ServiceGroup[] {
  const kids = items.filter((i) => i.practice.for_kids || categoryOf(i.practice, topics) === 'kids');
  return kids.length ? [{ key: KIDS, name: 'Детям', icon: categoryIcon(KIDS), tint: 'kids', items: kids }] : [];
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
