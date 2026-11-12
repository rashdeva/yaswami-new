// Переписка: диалог с человеком и сообщения в нём (docs/agents-inbox.md). Формы ответа API админки.
import * as z from 'zod';

export interface Conversation {
  id: string;
  /** Через что идёт переписка: бот «Я с вами» или один из наших аккаунтов Telegram (`account_id`). */
  channel: 'bot' | 'account';
  account_id: string | null;
  peer_id: number; // id чата в Telegram
  peer_name: string;
  peer_username: string | null;
  /** Кто ведёт диалог: `human` — мы сами, бот и агенты в нём молчат. */
  mode: 'agent' | 'human';
  /** Почему диалог ждёт нас; null — не ждёт. */
  attention: string | null;
  /**
   * Мы скрыли диалог из админки: человеку отвечать не собираемся (спам, случайный). Следующее его сообщение снимает
   * скрытие. В Luma переписки нет; имя поля во входе — `is_hidden`, как у типов билетов Luma.
   */
  hidden_at: Date | null;
  last_message_at: Date;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  /** `user` — человек, `bot` — автоматический ответ или уведомление, `admin:<telegram id>` — кто-то из нас, `agent` — агент через MCP, `agent:support` — роль поддержки. */
  author: string;
  text: string;
  /**
   * `draft` — написал агент, ждёт нашего «отправить»; `queued` — ждёт отправки с аккаунта: её делает сборщик, а не API.
   */
  status: 'received' | 'draft' | 'queued' | 'sent' | 'failed';
  meta: MessageMeta | null;
  created_at: Date;
}

/** Откуда взялся черновик агента и куда его отправлять. */
export interface MessageMeta {
  /** Почему агент хочет это написать — показываем рядом с черновиком. */
  reason?: string;
  /** Сообщение в чате, на которое это ответ: ссылка для нас. */
  source_url?: string;
  /** Отправить не в личку, а ответом на это сообщение в группе. */
  reply_to?: { chat: string; message_id: number };
}

/** Лента админки: последние диалоги и последние сообщения во всех диалогах, свежие первыми. */
export interface InboxFeed {
  me: number;
  conversations: InboxConversation[];
  messages: Message[];
  accounts: TgAccount[];
}

/**
 * Диалог в админке: кто это и на каком он шаге. Шаг не хранится, а выводится из переписки и из того,
 * вошёл ли человек в сервис, — поэтому не устаревает и не требует ручной отметки.
 */
export interface InboxConversation extends Conversation {
  /** `organizer` — у человека есть профиль организатора (собран сборщиком по его анонсам). */
  kind: 'organizer' | 'guest';
  stage: InboxStage;
  /** Какой агент писал в этом диалоге; null — никакой (только бот или мы сами). */
  agent: AgentKey | null;
}

/**
 * Наши агенты — роли в Hermes (agents/). `operator` — собеседник команды в командном чате: в диалогах он появляется,
 * когда пишет человеку по нашему поручению.
 */
export const AGENTS = {
  support: { name: 'Поддержка', about: 'Отвечает людям, которые пишут боту «Я с вами»: как записаться, куда сходить, их события.', sends: 'Сам, сразу — только в ответ на сообщение человека боту.' },
  hunter: { name: 'Охотник', about: 'Находит в чатах вопросы «куда сходить» и предлагает ответить событием из каталога.', sends: 'Только после вашего «Отправить»: ответом в чате с нашего аккаунта.' },
  host: { name: 'Для организаторов', about: 'Пишет организатору, когда на его событие записались через нас, и отвечает на его вопросы.', sends: 'Только после вашего «Отправить»: в личку с нашего аккаунта.' },
  operator: { name: 'Оператор', about: 'Ваш собеседник в командном чате Telegram: сводки, поиск по переписке, действия по вашему поручению.', sends: 'По вашему «да» в командном чате.' },
} as const;
export type AgentKey = keyof typeof AGENTS;

/** Что агент сделал — для раздела «Агенты». */
export interface AgentStats {
  key: AgentKey;
  /** Роль подключена к API (задан адрес её входа); оператор работает через командный чат и включён всегда. */
  enabled: boolean;
  conversations: number;
  drafts: number; // ждут нашего решения
  sent: number;
  sent_today: number; // за последние 24 часа
}

/** Организатор событий каталога — для раздела «Организаторы». Профиль собран сборщиком по его открытому Telegram. */
export interface HostRow {
  telegram_id: number;
  name: string;
  username: string;
  channel: string | null;
  summary: string | null;
  /** Вошёл в сервис сам. */
  registered: boolean;
  events: number; // предстоящих событий в каталоге
  signups: number; // сколько раз на них нажали «Записаться»
  /** Диалог с ним, если мы уже общались или готовим сообщение. */
  conversation_id: string | null;
  stage: InboxStage | null;
}

export interface AdminOverview {
  agents: AgentStats[];
  hosts: HostRow[];
}

export const INBOX_STAGES = {
  bot: 'Пишет боту',
  wrote_us: 'Написал сам',
  draft: 'Черновик ждёт',
  contacted: 'Написали, ждём ответа',
  replied: 'Ответил',
  joined: 'В сервисе',
} as const;
export type InboxStage = keyof typeof INBOX_STAGES;

/**
 * Аккаунт Telegram, с которого мы пишем людям. Вход идёт по шагам: админка записывает номер, код и пароль,
 * сборщик (у него MTProto) выполняет шаг и меняет `status`. Сессия аккаунта наружу не отдаётся никогда.
 */
export interface TgAccount {
  id: string;
  label: string;
  phone: string;
  /** login_requested — ждём, пока сборщик запросит код; login_code / login_password — ждём ввода в админке. */
  status: 'login_requested' | 'login_code' | 'login_password' | 'active' | 'error';
  last_error: string | null;
  created_at: Date;
}

export const AccountCreateInput = z.object({ label: z.string().trim().min(1).max(40), phone: z.string().trim().regex(/^\+\d{7,15}$/) });
export type AccountCreateInput = z.infer<typeof AccountCreateInput>;

/** Подпись аккаунта в админке; номер и вход не меняются. */
export const AccountUpdateInput = AccountCreateInput.pick({ label: true });
export type AccountUpdateInput = z.infer<typeof AccountUpdateInput>;

/** Шаг входа: код из Telegram или пароль двухэтапной проверки — что именно, определяет `status` аккаунта. */
export const AccountLoginInput = z.object({ secret: z.string().trim().min(1).max(200) });
export type AccountLoginInput = z.infer<typeof AccountLoginInput>;

/** Сборщик сообщает API о личном сообщении на аккаунте: входящем или нашем, написанном прямо из Telegram. */
export const AccountMessageInput = z.object({
  account_id: z.uuid(),
  peer: z.object({ id: z.number().int(), name: z.string().min(1).max(200), username: z.string().nullable() }),
  direction: z.enum(['in', 'out']),
  text: z.string().min(1).max(10_000),
});
export type AccountMessageInput = z.infer<typeof AccountMessageInput>;

/**
 * Сборщик сообщает, что человек набирает сообщение на наш аккаунт (Telegram присылает это аккаунту, а боту — нет).
 * В Luma переписки нет; имя наше.
 */
export const AccountTypingInput = z.object({ account_id: z.uuid(), peer_id: z.number().int() });
export type AccountTypingInput = z.infer<typeof AccountTypingInput>;

/**
 * Кто сейчас пишет в диалоге: агент готовит ответ (`text` — сколько уже написано) или человек набирает сообщение.
 * Мгновенное состояние: не хранится, приходит в админку потоком `GET /admin/live`. В Luma такого нет.
 */
export interface Typing {
  conversation_id: string;
  who: 'agent' | 'user';
  agent: AgentKey | null;
  text: string | null;
}

/** Сборщик нашёл в чате вопрос «куда сходить»: сообщение, его автор и несколько сообщений перед ним. */
export const LeadInput = z.object({
  chat: z.string().min(1).max(100),
  message_id: z.number().int(),
  url: z.string().max(300),
  author: z.object({ id: z.number().int(), name: z.string().min(1).max(200), username: z.string().nullable() }),
  text: z.string().min(1).max(1000),
  context: z.array(z.string().max(1000)).max(5),
});
export type LeadInput = z.infer<typeof LeadInput>;

/** Отправить черновик агента, при желании — с исправленным текстом. */
export const DraftSendInput = z.object({ text: z.string().trim().min(1).max(4000).optional() });
export type DraftSendInput = z.infer<typeof DraftSendInput>;

export const InboxSendInput = z.object({ text: z.string().trim().min(1).max(4000) });
export type InboxSendInput = z.infer<typeof InboxSendInput>;

/** Новый текст черновика агента: сообщение остаётся черновиком и ждёт «Отправить». */
export const DraftUpdateInput = InboxSendInput;
export type DraftUpdateInput = InboxSendInput;

/** `is_hidden: true` — скрыть диалог и снять «ждёт вас», `false` — вернуть в список. */
export const ConversationUpdateInput = z.object({ mode: z.enum(['agent', 'human']).optional(), attention: z.null().optional(), is_hidden: z.boolean().optional() });
export type ConversationUpdateInput = z.infer<typeof ConversationUpdateInput>;
