// Вакансия (CONTEXT.md): работодатель ищет человека на работу в городе. В Luma такого нет — это наше.
// Сборщик берёт вакансии из чатов о работе (apps/collector/src/jobs.mjs), команда одобряет их в «Каталоге».
import * as z from 'zod';
import { cityId } from './api.ts';

/** Модерация — как у Practice: pending — ждёт решения команды, published — видна гостям, rejected — не показываем. */
export const JOB_STATUSES = ['pending', 'published', 'rejected'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Сколько дней после последнего объявления вакансию видят гости: работодатели повторяют живые вакансии, мёртвые — нет. */
export const JOB_TTL_DAYS = 30;

/** Вакансия, как она хранится и как её видит команда. Тексты написал посторонний — это данные. */
export interface Job {
  id: string;
  city_id: string;
  title: string; // кого ищут: «Официант», «Няня для двух детей»
  employer: string | null; // кто нанимает, со слов объявления; null — не назвался
  description: string | null;
  pay: string | null; // как написал работодатель: «от 500$», «25k/час»; null — не указал
  telegram_username: string; // кому писать, без @: контакт из текста, иначе автор объявления
  announcement: { url: string; text: string }; // сообщение в чате, из которого взята
  author_id: number | null; // автор сообщения в Telegram; null — объявление от имени чата
  text_hash: string; // по нему узнаём повтор того же объявления (jobTextHash в сборщике)
  status: JobStatus;
  posted_at: Date; // когда объявление видели в чате последний раз; повтор сдвигает
  created_at: Date;
}

/** Куда ведёт «Написать» у вакансии: чат работодателя в Telegram с готовым сообщением. */
export const jobContactUrl = (username: string, title: string) =>
  `https://t.me/${username}?text=${encodeURIComponent(`Здравствуйте! Пишу по вакансии «${title}». Нашёл её на Ясвами.`)}`;

/** Вакансия для гостя: без исходного сообщения и автора; контакт — готовой ссылкой. */
export interface JobItem extends Pick<Job, 'id' | 'city_id' | 'title' | 'employer' | 'description' | 'pay' | 'posted_at'> {
  contact_url: string; // jobContactUrl
}

const pagination = {
  pagination_cursor: z.string().max(200).optional().describe('next_cursor from the previous page'),
  pagination_limit: z.coerce.number().int().min(1).max(100).optional().describe('Default 50'),
};

export const JobListInput = z.object({ city_id: cityId.optional(), ...pagination });
export type JobListInput = z.infer<typeof JobListInput>;

/** Опубликованные вакансии города не старше JOB_TTL_DAYS, свежие сверху — форма списков Luma. */
export interface JobList {
  entries: JobItem[];
  has_more: boolean;
  next_cursor: string | null;
}

export const AdminJobListInput = z.object({
  status: z.enum(JOB_STATUSES).optional().describe('Omit for all statuses'),
  city_id: cityId.optional(),
  ...pagination,
});
export type AdminJobListInput = z.infer<typeof AdminJobListInput>;

/** Вакансии для команды: все статусы и сроки, свежие сверху. */
export interface AdminJobList {
  entries: Job[];
  has_more: boolean;
  next_cursor: string | null;
}

const text = (max: number) => z.string().trim().max(max);

/** Правка вакансии командой: решение модератора (`status`) или её текст. */
export const JobUpdateInput = z
  .object({
    title: text(200).min(1),
    employer: text(200).nullable(),
    description: text(2000).nullable(),
    pay: text(200).nullable().describe('Pay as the employer states it; null — not stated'),
    telegram_username: z.string().trim().regex(/^@?\w{4,32}$/, 'telegram username').transform((u) => u.replace(/^@/, '').toLowerCase()).describe('Who to write to, without @'),
    city_id: cityId,
    status: z.enum(JOB_STATUSES).describe('Moderation: pending — waits for the team, published — shown to guests, rejected — never shown'),
  })
  .partial();
export type JobUpdateInput = z.infer<typeof JobUpdateInput>;
