// Формы запросов и ответов. Одни и те же схемы проверяют REST-запросы, описывают инструменты MCP и формы на фронте.
import * as z from 'zod';
import type { Event, Feature, Guest, TicketType, User } from './schema.ts';
import type { JobItem } from './jobs.ts';
import { Event as EventSchema, Notification, RsvpInput, TicketType as TicketTypeSchema } from './schema.ts';
import { OTHER_TOPIC, isTopic } from './topics.ts';

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
// В JSON дата — строка ISO с часовым поясом; в Date её превращает бэк.
export const dateTime = z.iso.datetime({ offset: true }).describe('ISO 8601 with offset, e.g. 2026-11-20T19:00:00+04:00');
/** Ссылка на город в правках команды. Не указан при создании — город по умолчанию (DEFAULT_CITY_ID). */
export const cityId = z.string().max(40).describe('City id from cities_list; defaults to the first city');
export const timeZone = z.string().refine(isTimeZone, 'unknown time zone').describe('IANA time zone, e.g. Asia/Tbilisi');

const eventFields = EventSchema.pick({
  kind: true, name: true, description: true, geo_address_json: true, meeting_url: true, max_capacity: true, allow_plus_one: true,
  topic: true, what_happens: true, for_whom: true, beginner_friendly: true, takeaway: true, guide: true,
}).extend({ start_at: dateTime, end_at: dateTime.nullable(), timezone: timeZone });

const ticketTypeFields = TicketTypeSchema.omit({ id: true, event_id: true });

export const EventCreateInput = eventFields
  .partial({
    description: true, end_at: true, geo_address_json: true, meeting_url: true, max_capacity: true, allow_plus_one: true,
    topic: true, what_happens: true, for_whom: true, beginner_friendly: true, takeaway: true, guide: true,
  })
  .extend({
    status: z.enum(['draft', 'published']).optional(),
    // Типы билетов сразу при создании (порядок = position). Без них — один «Стандартный» без цены.
    ticket_types: z.array(ticketTypeFields.partial()).max(10).optional(),
  });
export type EventCreateInput = z.infer<typeof EventCreateInput>;

export const EventUpdateInput = eventFields.extend({ status: EventSchema.shape.status }).partial();
export type EventUpdateInput = z.infer<typeof EventUpdateInput>;

export const TicketTypeCreateInput = ticketTypeFields.partial().required({ name: true });
export type TicketTypeCreateInput = z.infer<typeof TicketTypeCreateInput>;

export const TicketTypeUpdateInput = ticketTypeFields.partial();
export type TicketTypeUpdateInput = z.infer<typeof TicketTypeUpdateInput>;

export { RsvpInput };

/** Вход через Apple в приложении: id_token от Apple и имя, которое Apple отдаёт только при первом входе. В Luma такого нет. */
export const AppleLoginInput = z.object({
  id_token: z.string().min(1).max(8000),
  first_name: z.string().trim().min(1).max(60).optional(),
});
export type AppleLoginInput = z.infer<typeof AppleLoginInput>;

/** Вход через Google в приложении: id_token от Google, имя Google кладёт в сам токен. В Luma такого нет. */
export const GoogleLoginInput = z.object({ id_token: z.string().min(1).max(8000) });
export type GoogleLoginInput = z.infer<typeof GoogleLoginInput>;

/** Заход на событие. `ref` — id пользователя, по чьей ссылке пришли (хвост `-r<id>` в startapp). */
export const VisitInput = z.object({ ref: z.number().int().optional() });
export type VisitInput = z.infer<typeof VisitInput>;

/** Поиск человека среди пользователей сервиса; без запроса — список. */
export const UserSearchInput = z.object({ query: z.string().trim().min(1).max(64).optional().describe('Part of a first name or @username; omit to list everyone (first 50 by name)') });
export type UserSearchInput = z.infer<typeof UserSearchInput>;

/** Решение иллюстратора об обложке собранного события. */
export const CoverSetInput = z.object({
  image_url: z.url().optional().describe('Public URL of a generated 9:16 image (files-cdn.x.ai). Omit to keep the announcement photo as the cover.'),
});
export type CoverSetInput = z.infer<typeof CoverSetInput>;

/** Гость, как его видят другие: только имя и фото, без username и id. */
export interface GuestView {
  user_first_name: string;
  user_photo_url: string | null; // аватар из Telegram, сохранённый у нас; null — фото нет
  approval_status: Guest['approval_status'];
  event_ticket_type_id: string | null;
  plus_ones: number;
  is_me: boolean;
}

/** Событие целиком для одного зрителя. Скрытые типы билетов видит организатор и тот, кому тип назначен. */
export interface EventView {
  event: Event;
  cover_url: string | null; // в Luma — event.cover_url; у нас картинка хранится отдельно от строки события, поэтому рядом с ним
  cover_pending: boolean; // в Luma нет: обложку сейчас рисует иллюстратор, через минуту-другую появится cover_url
  ticket_types: TicketType[];
  host: { first_name: string; user_photo_url: string | null };
  guests: GuestView[]; // отказавшихся видит только организатор
  guest_counts: { approved: number; maybe: number; declined: number }; // approved — занятые места, с учётом «+1»
  /** Отзывы гостей после события: средняя оценка видна всем, сами отзывы — только организатору. */
  feedback: { count: number; average: number | null; items: { user_first_name: string; rating: number; comment: string | null }[] };
  me: Guest | null;
  is_host: boolean;
}

export interface EventListItem {
  event: Event;
  cover_url: string | null; // как в EventView: в Luma — event.cover_url
  is_host: boolean;
  my_approval_status: Guest['approval_status'] | null;
}

const parsableDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'not a date');
/**
 * Событие, собранное из Telegram-канала или Instagram-профиля (apps/collector): хозяина в Ясвами у него ещё нет, данные извлечены ИИ.
 * Схемой проверяется ответ ИИ (packages/extract): событие, которое база не примет, отбрасывается до записи.
 */
export const CollectedEvent = z.object({
  title: z.string().min(1),
  description: z.string(),
  starts_at: parsableDate, // ISO 8601 с offset часового пояса города
  ends_at: parsableDate.nullable(),
  place: z.string().nullable(),
  address: z.string().nullable(),
  price: z.string().nullable(),
  tags: z.array(z.string()),
  telegram_username: z.string().nullable(),
  whatsapp_phone: z.string().nullable(),
  // Ник в Instagram без @: «Записаться» ведёт в директ, если нет Telegram, WhatsApp и ссылки. Ставит сборщик событиям
  // из Instagram-источника — ИИ его не выдаёт. В Luma такого нет.
  instagram_username: z.string().nullable().optional(),
  url: z.string().nullable(),
  // Ниже — «что это мне даст»: поля появились позже остальных, у ранее собранных событий их нет.
  topic: z.string().optional(), // ключ TOPIC_GUIDES или OTHER_TOPIC
  what_happens: z.array(z.string()).optional(), // что человек будет делать, по порядку публикации
  for_whom: z.string().nullable().optional(),
  beginner_friendly: z.boolean().nullable().optional(), // null — в анонсе не сказано
  takeaway: z.string().nullable().optional(), // только обещание самого организатора
});
export type CollectedEvent = z.infer<typeof CollectedEvent>;

/**
 * Организатор собранного события: профиль составлен автоматически по его Telegram и каналу. Имена — как у Host
 * в Luma API (`hosts`, `name`); `summary`, `channel_url` и `confirmed` — наши: у человека в Luma нет ни описания, ни ссылок.
 */
export interface CollectedHost {
  name: string;
  summary: string | null; // сводка ИИ по каналу и «о себе»
  channel_url: string | null;
  instagram_handle: string | null; // ник в Instagram без @, как у Host в Luma: страница — instagram.com/<ник>
  photo_url: string; // аватарка прямо с серверов Telegram, у себя не храним; если фото нет или оно скрыто — по адресу 404
  confirmed: boolean; // человек вошёл в Ясвами; иначе профиль собран без его участия
  /** Фото сообщества: последние картинки из канала, сохранённые у нас; новые сверху. `source_url` — публикация, из которой взято фото. */
  photos: { url: string; source_url: string }[];
}

/**
 * Practice: устойчивое предложение организатора без даты — регулярные занятия, услуга мастера (CONTEXT.md).
 * Сборщик извлекает его из самопредставления в чате. В Luma такого нет.
 */
/**
 * Модерация Practice — как у собранных событий, но без шага обработки: pending — ждёт решения команды,
 * published — видна в каталоге, rejected — не показываем. В Luma такого нет.
 */
export const PRACTICE_STATUSES = ['pending', 'published', 'rejected'] as const;
export type PracticeStatus = (typeof PRACTICE_STATUSES)[number];

export interface Practice {
  id: string; // по нему на Practice записываются и команда принимает решение: название можно править
  title: string;
  topic: string; // ключ TOPIC_GUIDES или OTHER_TOPIC
  description: string | null;
  price: string | null; // как написал сам организатор
  status: PracticeStatus; // модерация: в каталоге видна только published
}

/** Запись на Practice — по её id. В Luma такого нет. */
export const PracticeSignupInput = z.object({ practice_id: z.uuid().describe('Practice id from `practices` of the organizer') });
export type PracticeSignupInput = z.infer<typeof PracticeSignupInput>;

/** Ответ на запись: куда идти дальше — запись подтверждает сам мастер. */
export interface PracticeSignup { signup_url: string }

/** Куда ведёт «Записаться» у Practice: чат мастера в Telegram с готовым сообщением. */
export const practiceSignupUrl = (username: string, title: string) =>
  `https://t.me/${username}?text=${encodeURIComponent(`Здравствуйте! Хочу записаться: «${title}». Нашёл вас на Ясвами.`)}`;

/**
 * Организатор в каталоге «Организаторы»: тот, у кого есть предстоящие события или Practice из наших Topic.
 * В Luma общего списка Host нет — там Host живёт только внутри события; поля — как у CollectedHost.
 */
export interface HostListItem extends Omit<CollectedHost, 'photos'> {
  id: string;
  username: string; // без @: по нему пишут организатору
  contact_url: string; // t.me/<username>
  url: string; // страница мастера в Ясвами: там его услуги с кнопкой «Записаться»
  topics: string[]; // темы его Practice и предстоящих событий, порядок — как в TOPIC_GUIDES
  practices: Practice[];
  upcoming_count: number; // предстоящих опубликованных событий
}

/** Страница организатора: то же, что в каталоге, плюс фото сообщества и предстоящие события. */
export interface HostItem extends HostListItem {
  photos: CollectedHost['photos'];
  events: CollectedEventItem[];
}

/**
 * Единый поиск по публичному каталогу: предстоящие события и услуги мастеров (Practice). В Luma общего поиска нет;
 * `query` — как у `places/search`, список — как у остальных (`entries`).
 */
export const SearchInput = z.object({
  city_id: cityId.optional(),
  query: z.string().trim().min(2).max(100).describe('What to look for, in the person\'s own words: "йога", "массаж", "ретрит". Word endings and small typos are tolerated'),
  pagination_limit: z.coerce.number().int().min(1).max(50).optional().describe('Default 20'),
});
export type SearchInput = z.infer<typeof SearchInput>;

/** Город витрины: события и организаторы только этого города. В Luma города нет — там выдача по календарю. */
export const CityFilterInput = z.object({ city_id: cityId.optional() });
export type CityFilterInput = z.infer<typeof CityFilterInput>;

/**
 * Находка поиска; `type` говорит, что это. У Practice своей страницы нет — открывается её мастер (`host`).
 * Вакансия (`job`) — из раздела «Вакансии».
 * Самих организаторов поиск не выдаёт: человек ищет, куда пойти или что заказать, а не кого.
 */
export type SearchEntry =
  | { type: 'event'; event: CollectedEventItem }
  | { type: 'practice'; practice: Practice; host: HostListItem }
  | { type: 'job'; job: JobItem };
export interface SearchResult { entries: SearchEntry[] } // самые подходящие первыми

/** Фото или видео из публикации-источника; лежит в нашем бакете (ADR-0006). В Luma такого нет. */
export interface CollectedMedia {
  type: 'photo' | 'video';
  url: string;
  width?: number | null; // в пикселях; по ним страница решает, годится ли ролик в обложку. У файлов до размеров — нет
  height?: number | null;
}

/** Карточка собранного события для витрины. */
export interface CollectedEventItem extends Omit<CollectedEvent, 'telegram_username' | 'whatsapp_phone' | 'instagram_username' | 'url'> {
  id: string; // годится для адреса страницы: <канал>-<публикация>-<номер события в ней>, из Instagram — ig.<публикация>-<номер>
  signup_url: string; // куда ведёт «Записаться»: к организатору, а не в Ясвами
  source_url: string; // публикация, из которой взято событие
  claimed_event_id: Event['id'] | null; // организатор подтвердил событие: запись идёт через событие Ясвами
  city_id: string; // город события: достаётся от источника, команда может сменить
  hosts?: CollectedHost[]; // как hosts у события в Luma; только в ответе на одно событие, в списках его нет
  signups_count?: number; // сколько человек нажали «Записаться» в Ясвами (это интерес, не подтверждённое место); только в ответе на одно событие
  cover_url?: string | null; // обложка 9:16: фото анонса или нарисованная; нет — показываем иконку темы
  video_url?: string | null; // ролик-история 9:16 о событии; название и время накладывает страница, в самом ролике текста нет
  media?: CollectedMedia[]; // в Luma нет: фото и видео из публикации-источника, в порядке альбома
  popular?: boolean; // отклик заметно выше обычного для этого источника (popularIds)
}

/** Путь собранного события от разбора анонса до ленты; в ленте — только published. */
export const COLLECTED_STATUSES = ['pending', 'approved', 'published', 'rejected'] as const;
export type CollectedStatus = (typeof COLLECTED_STATUSES)[number];

/** Собранное событие в админке модерации: любого статуса, с источником и контактами, которые витрина прячет. */
export interface AdminCollectedEvent extends CollectedEventItem, Pick<CollectedEvent, 'telegram_username' | 'whatsapp_phone' | 'instagram_username' | 'url'> {
  status: CollectedStatus;
  channel: string; // источник: канал или группа, откуда анонс; instagram:<ник> — Instagram-профиль
  source_text: string | null; // текст публикации-источника: с ним модератор сверяет, что извлёк ИИ
  // Отклик на публикацию-источник — только для команды: в витрине из него получается лишь пометка «Популярное».
  views: number | null; // просмотры; у публикаций в группах их нет
  reactions: number | null; // сколько реакций под публикацией
}

/** Отбор собранных событий в модерации: без статуса — все; без `before` — предстоящие. */
export const CollectedListInput = z.object({
  status: z.enum(COLLECTED_STATUSES).optional().describe('Only this status; pending — waiting for a decision'),
  before: dateTime.optional().describe('Only events that ended before this moment, newest first; pass the current time for past events. Without it — upcoming events'),
});
export type CollectedListInput = z.infer<typeof CollectedListInput>;

// Правка и решение модератора — CollectedUpdateInput в admin.ts.

/**
 * Source: канал или группа Telegram или профиль Instagram, откуда сборщик берёт анонсы. Источники добавляет команда,
 * а каналы и Instagram организаторов — сборщик сам, по их профилю. В Luma такого нет.
 */
export interface AdminSource {
  channel: string; // username без @, id закрытого чата (-100…) или instagram:<ник> — профиль Instagram
  kind: SourceKind;
  enabled: boolean; // выключенный сборщик не читает
  // Почему выключил сборщик: канала нет в Telegram или он закрыт. null — выключила команда или источник включён.
  disabled_reason: string | null;
  city_id: string; // город источника: его получают события из этого источника, в его часовом поясе ИИ читает время
  // Организатор источника: чей это канал. Сборщик ставит его сам, когда берёт канал из профиля; команда может указать
  // или сменить. Анонс без контакта из такого источника получает контактом этого организатора. null — не указан.
  host: { id: string; name: string; username: string } | null;
  events_count: number; // сколько собранных событий из него пришло за всё время
  created_at: Date;
}

/**
 * Что сборщик берёт из источника: announcements — анонсы событий; leads — большой чат города: вопросы «куда сходить»,
 * мастера и вакансии; jobs — чат о работе: только вакансии. Мастера и вакансии получают город источника.
 */
export const SOURCE_KINDS = ['announcements', 'leads', 'jobs'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
const sourceKind = z.enum(SOURCE_KINDS).describe('announcements — event announcements (default); leads — a big city chat: questions "where to go", masters and job vacancies; jobs — a job chat: vacancies only');

/**
 * Источник Instagram хранится как `instagram:<ник>`: ник в Instagram может совпасть с чужим username в Telegram.
 * Ник — без @, в нижнем регистре; null — источник из Telegram.
 */
export const INSTAGRAM_SOURCE = 'instagram:';
export const instagramOf = (channel: string): string | null => (channel.startsWith(INSTAGRAM_SOURCE) ? channel.slice(INSTAGRAM_SOURCE.length) : null);
const INSTAGRAM_INPUT = /^(?:(?:https?:\/\/)?(?:www\.)?instagram\.com\/|instagram:)([\w.]{1,30})\/?(?:\?.*)?$/i;
/** Источник из того, что ввела команда: ссылка на Instagram — `instagram:<ник>`, иначе username канала или id чата. */
export const sourceChannel = (input: string): string => {
  const ig = INSTAGRAM_INPUT.exec(input.trim())?.[1];
  return ig ? INSTAGRAM_SOURCE + ig.toLowerCase() : input.trim().replace(/^(?:https?:\/\/)?(?:t\.me\/|@)?/, '').replace(/\/$/, '');
};

/** Добавить источник: username канала, @username, ссылка t.me/… или id закрытого чата, либо ссылка на профиль Instagram. */
export const SourceCreateInput = z.object({
  kind: sourceKind.optional(),
  channel: z.string().trim().regex(new RegExp(`^(?:https?:\\/\\/)?(?:t\\.me\\/|@)?\\w{4,32}\\/?$|^-100\\d+$|${INSTAGRAM_INPUT.source}`))
    .describe('Channel username, @username, t.me link, -100… id of a private chat, or an Instagram profile link (instagram.com/<handle>) or instagram:<handle>'),
  city_id: cityId.optional(),
});
export type SourceCreateInput = z.infer<typeof SourceCreateInput>;

export const SourceUpdateInput = z
  .object({
    enabled: z.boolean().describe('false — stop reading this source'),
    kind: sourceKind,
    host_id: z.uuid().nullable().describe('Organizer this source belongs to (id from admin_hosts_list); null — none'),
    city_id: cityId.describe('City of the source (id from admin_cities_list); events collected from now on get it, already collected ones keep theirs'),
  })
  .partial();
export type SourceUpdateInput = z.infer<typeof SourceUpdateInput>;

/**
 * Поиск источников для города: команда просит, сборщик в следующий проход ищет в Telegram каналы и группы по названию
 * города и его написаниям и для каждого считает, сколько публикаций за месяц похожи на анонс. Сам ничего не добавляет:
 * источник из найденного добавляет команда. В Luma такого нет.
 */
export const SOURCE_SEARCH_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type SourceSearchStatus = (typeof SOURCE_SEARCH_STATUSES)[number];

/** Найденный канал или группа Telegram или профиль Instagram. В Luma такого нет. */
export interface SourceCandidate {
  channel: string; // username без @ или instagram:<ник>
  title: string;
  group: boolean; // группа (чат), а не канал
  members: number | null;
  posts_30d: number; // публикаций за 30 дней среди последних 50
  event_like: number; // из них похожи на анонс (looksLikeEvent)
  kind: SourceKind; // какой вид источника подходит: канал — анонсы, группа — чат города, про работу — чат о работе
  added: boolean; // уже есть в источниках (включён или выключен)
}

export interface SourceSearch {
  id: string;
  city_id: string;
  names: string[]; // по чему искали: название города и его другие написания (City.aliases) на момент заявки
  status: SourceSearchStatus; // queued — ждёт сборщика, running — ищет (несколько минут), done, failed — см. error
  error: string | null;
  results: SourceCandidate[]; // лучшие первыми: больше похожих на анонс, потом больше публикаций
  created_at: Date;
  finished_at: Date | null;
}

export const SourceSearchCreateInput = z.object({ city_id: cityId });
export type SourceSearchCreateInput = z.infer<typeof SourceSearchCreateInput>;

/** Собранное событие в «Моих событиях»: куда человек заходил или нажимал «Записаться». */
export interface MyCollectedItem {
  event: CollectedEventItem;
  signed_up: boolean; // иначе только заходил
}

/**
 * Человек из аудитории организатора — как CalendarContact в Luma API (`GET /v1/calendars/contacts/list`): те же имена
 * полей, где они у нас есть. `username` — наше: вместо email у нас Telegram. Попадает в контакты, зайдя на событие
 * организатора или ответив на него.
 */
export interface Contact {
  id: string;
  user_id: User['id'];
  created_at: Date;
  event_approved_count: number; // на сколько событий организатора человек идёт
  first_name: string;
  username: string | null;
}

/** Кто вошёл и на какие собранные события он уже записывался. */
export interface Me {
  user: Pick<User, 'id' | 'first_name' | 'username'>;
  /** Возможности, открытые человеку: включённые лично и включённые всем. */
  features: Feature[];
  collected_signups: CollectedEventItem['id'][];
  /** Предстоящие собранные события, где контактом указан этот человек: их можно подтвердить как свои. */
  claimable: CollectedEventItem[];
  /** Профиль организатора, который человек подтвердил входом; null — он не организатор каталога. В Luma такого нет. */
  host_id: string | null;
  /** Подписка на темы: Topic, о новых событиях которых человеку пишет бот. null — ещё не спрашивали, [] — отказался. В Luma такого нет. */
  subscribed_topics: string[] | null;
  /** Город человека: его витрину открывает мини-приложение, о его событиях пишет сводка по темам. В Luma такого нет. */
  city_id: string;
  /** Уведомления бота, которые человек выключил. В Luma такого нет. */
  muted_notifications: Notification[];
}

/** Правка своих настроек: Подписка на темы, город и выключенные уведомления; меняется только переданное. В Luma такого нет. */
export const UserSelfUpdateInput = z.object({
  subscribed_topics: z.array(z.string().refine((t) => t !== OTHER_TOPIC && isTopic(t), 'unknown topic')).max(100)
    .transform((t) => [...new Set(t)]).describe('Topics the user wants to hear about (names from topics_list); the full list replaces the previous one, [] unsubscribes'),
  city_id: cityId.describe('City the user lives in (id from cities_list): the mini app opens its catalogue, the topic digest tells about its events'),
  muted_notifications: z.array(Notification).max(20).transform((n) => [...new Set(n)]).describe('Bot notifications the user turned off; the full list replaces the previous one, [] turns all on'),
}).partial();
export type UserSelfUpdateInput = z.infer<typeof UserSelfUpdateInput>;

/** Открытые настройки для фронта: из чего собрать ссылку на событие t.me/<бот>/<приложение>?startapp=<id>. */
export interface AppConfig {
  bot_username: string | null;
  app_name: string;
  web_login: boolean; // на сайте можно войти через Telegram (настроен Client Secret)
  free_events_limit: number; // сколько событий создаётся бесплатно
}

/** Тот же тип, каким он приходит по сети: даты в JSON — строки ISO. */
export type Wire<T> = T extends Date ? string : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;
