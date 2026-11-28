// Отзывы на услуги мастера (Practice без Session) и репутация организатора. В Luma такого нет: там у события
// только `feedback_email` — письмо с вопросом после события; ни ресурса отзывов, ни оценки организатора в API нет.
// Имена — наши, в пару к отзывам на событие (`feedback` у события, `event_feedback`).
import * as z from 'zod';

/** Сколько оценок нужно, чтобы показать среднюю: одна оценка — это мнение одного человека, а не репутация. */
export const FEEDBACK_AVERAGE_MIN = 3;
/** С какой оценки текст отзыва на услугу виден всем: «рекомендую». Ниже — текст получают только мастер и команда. */
export const FEEDBACK_PUBLIC_RATING = 4;
export const FEEDBACK_COMMENT_MAX = 1000;
export const FEEDBACK_BONUS_MAX = 120;

/**
 * Откуда отзыв на услугу: `signup` — человек записался на неё у нас («Записаться»); `invite` — записи у нас не было,
 * человек пришёл к боту по ссылке, которую мастер дал своему клиенту.
 */
export const FEEDBACK_VIA = ['signup', 'invite'] as const;
export type FeedbackVia = (typeof FEEDBACK_VIA)[number];

/** Средняя оценка, которую можно показать: null, пока оценок меньше FEEDBACK_AVERAGE_MIN. */
export const shownAverage = (ratings: number[]): number | null =>
  ratings.length >= FEEDBACK_AVERAGE_MIN ? ratings.reduce((n, r) => n + r, 0) / ratings.length : null;

/**
 * Отзыв виден всем: есть текст или голосовая запись, оценка не ниже FEEDBACK_PUBLIC_RATING, а отзыв, присланный ссылкой на чужое
 * сообщение (`source_url`), команда уже сверила с этим сообщением (`verified_at`).
 */
export const isPublicFeedback = (f: { rating: number | null; comment: string | null; audio_url?: string | null; source_url?: string | null; verified_at?: Date | null }): boolean =>
  (!!f.comment || !!f.audio_url) && (f.rating ?? 0) >= FEEDBACK_PUBLIC_RATING && (!f.source_url || !!f.verified_at);

/**
 * Сколько минут после оценки следующее сообщение человека боту считается отзывом, даже если это не ответ на вопрос
 * бота: так можно просто написать или переслать сообщение с отзывом. Позже — только ответом на вопрос бота.
 */
export const FEEDBACK_TEXT_MINUTES = 30;

/**
 * Репутация организатора: оценки его событий Ясвами и его услуг вместе.
 * `count` — сколько оценок; `average` — средняя, null — оценок меньше трёх; `attended_count` — сколько разных людей
 * ответили, что были у него (оценили событие или услугу).
 */
export interface HostFeedbackSummary {
  count: number;
  average: number | null;
  attended_count: number;
}

/** Отзыв на услугу, который видят все (isPublicFeedback). */
export interface HostFeedbackEntry {
  user_first_name: string;
  practice_title: string;
  rating: number;
  comment: string | null; // текст; у голосового — расшифровка речи, null — расшифровать не вышло
  audio_url: string | null; // голосовой отзыв: запись, которую человек прислал боту; null — отзыв текстом
  audio_duration: number | null; // её длительность в секундах
  via: FeedbackVia;
  source_url: string | null; // сообщение, где человек написал этот отзыв (Telegram, Instagram); null — написал боту
  updated_at: Date;
}

/** Правка своего профиля организатора самим мастером. Пока одно поле: что он даёт гостю за отзыв; null — убрать. */
export const HostSelfUpdateInput = z.object({
  feedback_bonus: z.string().trim().min(1).max(FEEDBACK_BONUS_MAX).nullable()
    .describe('What the organizer gives a guest for leaving feedback, in their own words ("−10% на следующий визит"); null removes it. The organizer honours it themselves: the service does not check or pay it'),
});
export type HostSelfUpdateInput = z.infer<typeof HostSelfUpdateInput>;

/** Свой профиль организатора. `feedback_url` — ссылка «оставьте отзыв обо мне» для клиентов мастера: открывает бота. */
export interface HostSelf {
  host_id: string;
  feedback_bonus: string | null;
  feedback_url: string;
}

/** Отзыв на услугу глазами команды: любой, и без ответа тоже. */
export interface AdminHostFeedback {
  host_id: string;
  practice_id: string;
  practice_title: string;
  user_id: number;
  user_first_name: string;
  user_username: string | null;
  via: FeedbackVia;
  attended: boolean | null; // был ли у мастера: null — бот спросил, ответа нет; false — не дошёл
  rating: number | null;
  comment: string | null;
  audio_url: string | null; // запись голосового отзыва; `comment` у него — расшифровка, её можно поправить
  audio_duration: number | null;
  source_url: string | null; // ссылка на сообщение с отзывом, которую прислал человек: команда сверяет её сама
  verified_at: Date | null; // команда сверила ссылку; у пересланного из канала ставится сразу — пересылку не подделать
  requested_at: Date;
  updated_at: Date;
}

/**
 * Решение команды по отзыву, присланному ссылкой: `verified: true` — ссылка ведёт на отзыв этого человека об этом
 * мастере, отзыв можно показывать; `comment` — его текст, переписанный из сообщения по ссылке (сами мы его не читаем),
 * или поправленная расшифровка голосового отзыва.
 */
export const HostFeedbackUpdateInput = z.object({
  verified: z.boolean().describe('true — the team checked the linked message: it is this person\'s feedback on this organizer; false — takes the check back'),
  comment: z.string().trim().max(FEEDBACK_COMMENT_MAX).nullable().describe('Text of the feedback: copied from the linked message, or a corrected transcript of a voice feedback; null removes it'),
}).partial();
export type HostFeedbackUpdateInput = z.infer<typeof HostFeedbackUpdateInput>;
