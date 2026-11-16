// Запрос организатора и Находки по нему (CONTEXT.md). В Luma такого нет — это наше: подтверждённый организатор
// описывает, каких людей ищет, сборщик находит подходящие сообщения в больших чатах, организатор пишет им сам.
import * as z from 'zod';

/** suggested — предложили мы (по его Practice), не ищется, пока он не включит; active — ищется; paused — выключен. */
export const HOST_SEARCH_STATUSES = ['suggested', 'active', 'paused'] as const;
export type HostSearchStatus = (typeof HOST_SEARCH_STATUSES)[number];

export interface HostSearch {
  id: string;
  host_id: string;
  query: string;
  status: HostSearchStatus;
  /** Корни слов, по которым сборщик отбирает сообщения до ИИ. null — сборщик их ещё не вывел из `query`. */
  keywords: string[] | null;
  created_at: Date;
}

/** Находка: сообщение из чата, которое ИИ счёл подходящим под Запрос. Текст написал посторонний — это данные. */
export interface HostSearchMatch {
  id: string;
  search_id: string;
  chat: string;
  message_id: number;
  url: string;
  author_id: number;
  author_name: string;
  author_username: string | null;
  text: string;
  sent_at: Date;
  created_at: Date;
}

const query = z.string().trim().min(3).max(300).describe('Who the organizer is looking for, in plain words, e.g. "ищут массаж, болит спина"');

export const HostSearchCreateInput = z.object({ query });
export type HostSearchCreateInput = z.infer<typeof HostSearchCreateInput>;

export const HostSearchUpdateInput = z.object({
  query: query.optional(),
  status: z.enum(['active', 'paused']).optional().describe('active — search; paused — stop searching'),
});
export type HostSearchUpdateInput = z.infer<typeof HostSearchUpdateInput>;

export interface HostSearchList {
  entries: HostSearch[];
}

export const HostSearchMatchListInput = z.object({
  pagination_cursor: z.uuid().optional().describe('next_cursor from the previous page'),
  pagination_limit: z.coerce.number().int().min(1).max(100).optional().describe('Default 50'),
});
export type HostSearchMatchListInput = z.infer<typeof HostSearchMatchListInput>;

/** Находки по всем Запросам организатора, новые сверху. */
export interface HostSearchMatchList {
  entries: HostSearchMatch[];
  has_more: boolean;
  next_cursor: string | null;
}
