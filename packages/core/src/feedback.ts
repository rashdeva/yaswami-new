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
 * отзыв оставлен по ссылке, которую мастер дал своему клиенту.
 */
export const FEEDBACK_VIA = ['signup', 'invite'] as const;
export type FeedbackVia = (typeof FEEDBACK_VIA)[number];

/** Средняя оценка, которую можно показать: null, пока оценок меньше FEEDBACK_AVERAGE_MIN. */
export const shownAverage = (ratings: number[]): number | null =>
  ratings.length >= FEEDBACK_AVERAGE_MIN ? ratings.reduce((n, r) => n + r, 0) / ratings.length : null;

/** Текст отзыва виден всем: есть текст и оценка не ниже FEEDBACK_PUBLIC_RATING. */
export const isPublicFeedback = (f: { rating: number | null; comment: string | null }): boolean =>
  !!f.comment && (f.rating ?? 0) >= FEEDBACK_PUBLIC_RATING;

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
  comment: string;
  via: FeedbackVia;
  updated_at: Date;
}

/** Отзыв на услугу мастера от того, кто у него был. Повторный вызов заменяет прежний отзыв этого человека на эту услугу. */
export const HostFeedbackCreateInput = z.object({
  practice_id: z.uuid().describe('Practice id from `practices` of the organizer'),
  rating: z.number().int().min(1).max(5).describe('1–5'),
  comment: z.string().trim().max(FEEDBACK_COMMENT_MAX).optional().describe('A few words; shown publicly on the organizer page when rating is 4 or 5, otherwise only the organizer and the team see it'),
});
export type HostFeedbackCreateInput = z.infer<typeof HostFeedbackCreateInput>;

/** Сохранённый отзыв. `feedback_bonus` — что мастер обещал за отзыв (null — ничего): его человек предъявляет мастеру сам. */
export interface HostFeedbackCreated {
  practice_id: string;
  rating: number;
  comment: string | null;
  via: FeedbackVia;
  feedback_bonus: string | null;
}

/** Правка своего профиля организатора самим мастером. Пока одно поле: что он даёт гостю за отзыв; null — убрать. */
export const HostSelfUpdateInput = z.object({
  feedback_bonus: z.string().trim().min(1).max(FEEDBACK_BONUS_MAX).nullable()
    .describe('What the organizer gives a guest for leaving feedback, in their own words ("−10% на следующий визит"); null removes it. The organizer honours it themselves: the service does not check or pay it'),
});
export type HostSelfUpdateInput = z.infer<typeof HostSelfUpdateInput>;

/** Свой профиль организатора после правки. `feedback_url` — ссылка «оставьте отзыв обо мне» для клиентов мастера. */
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
  requested_at: Date;
  updated_at: Date;
}
