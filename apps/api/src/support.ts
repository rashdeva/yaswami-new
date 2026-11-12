// Роль поддержки — Hermes, профиль support (agents/support): отвечает людям, которые пишут боту не анонс, а вопрос.
// Мы передаём ей переписку и получаем текст ответа; отправляет его наш бот. Сама роль никому писать не может.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sseEvents } from '@yaswami/core';
import { settings } from './settings.ts';

export interface SupportTurn { role: 'system' | 'user' | 'assistant'; content: string }
export interface SupportReply {
  text: string;
  /** Роль просит позвать человека: причина для «Ждут вас». null — справилась сама. */
  human: string | null;
  /** События каталога, которые роль показывает карточками под ответом (id из collected_events_list). */
  events?: string[];
}

const TICKET_TTL_S = 30 * 60;
// Ключ подписи билетов — свой и случайный, а не ключ входа роли: тот знает контейнер Hermes, и его утечка дала бы
// подделать билет на любого человека. ponytail: ключ живёт в памяти процесса — перезапуск API гасит выданные билеты
// (роль получает новый с каждым сообщением), а второй экземпляр API потребует общего ключа из окружения.
const ticketKey = randomBytes(32);
const sign = (payload: string) => createHmac('sha256', ticketKey).update(payload).digest('base64url');

/**
 * Билет собеседника: с ним роль вызывает инструменты `person_*` от имени именно этого человека (mcp.ts).
 * Билет подписан и живёт полчаса; роль получает его от нас вместе с перепиской, подделать его в сообщении нельзя.
 */
export const issueTicket = (userId: number, now = Date.now()) => {
  const payload = `${userId}.${Math.floor(now / 1000) + TICKET_TTL_S}`;
  return `${payload}.${sign(payload)}`;
};

/** Чей это билет; null — подпись не наша, срок вышел или ключ роли не задан. */
export function verifyTicket(ticket: string, now = Date.now()): number | null {
  const [userId, expires, signature] = ticket.split('.');
  if (!settings.supportKey || !userId || !expires || !signature) return null;
  const expected = Buffer.from(sign(`${userId}.${expires}`));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return Number(expires) * 1000 > now ? Number(userId) : null;
}

// Так роль зовёт человека (agents/support/SOUL.md): отдельная строка в ответе, человеку её не показываем.
const HUMAN_MARK = /^[ \t]*\[\[человек:(.*?)\]\][ \t]*$/im;

// Так роль показывает событие: отдельная строка, вместо неё бот присылает карточку с обложкой и кнопкой.
const EVENT_MARK = /^[ \t]*\[\[событие:\s*(.*?)\]\][ \t]*$/gim;
const EVENTS_SHOWN = 3; // больше карточек подряд — уже лента, а не ответ

export function parseSupportReply(content: string): SupportReply {
  const mark = HUMAN_MARK.exec(content);
  const events = [...new Set([...content.matchAll(EVENT_MARK)].map((m) => m[1]!.trim()).filter(Boolean))].slice(0, EVENTS_SHOWN);
  const text = content.replace(HUMAN_MARK, '').replace(EVENT_MARK, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text, human: mark ? mark[1]!.trim() || 'Просит человека' : null, events };
}

/**
 * Текст, который уже можно показать человеку, пока роль дописывает ответ: без пометок, и без последней строки,
 * если она начинается с «[», — это может быть недописанная пометка.
 */
export const visibleSoFar = (partial: string) => parseSupportReply(partial.replace(/(^|\n)[ \t]*\[[^\n]*$/, '')).text;

interface HermesChoice { message?: { content?: string }; delta?: { content?: string }; finish_reason?: string | null }
interface HermesBody { choices?: HermesChoice[]; hermes?: { failed?: boolean; error?: string } }

/**
 * Вопрос роли Hermes по её HTTP-входу. null — роль недоступна или ответила пусто. Не бросает.
 * С `onText` ответ идёт потоком (`stream: true`): `onText` получает весь текст, написанный к этому моменту.
 */
async function askRole(url: string, key: string, history: SupportTurn[], timeoutMs = 90_000, onText?: (text: string) => void): Promise<string | null> {
  try {
    const res = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'hermes-agent', messages: history, ...(onText ? { stream: true } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    // Модель отказала (кончились кредиты, лимит) — Hermes всё равно отвечает 200, а в content кладёт текст ошибки.
    // Отправлять его человеку нельзя: это сбой роли. В потоке признак сбоя приходит последним кадром.
    const failed = (body: HermesBody) => body.hermes?.failed || body.choices?.[0]?.finish_reason === 'error';
    let content = '';
    let error: string | undefined;
    if (res.body && res.headers.get('content-type')?.includes('text/event-stream')) {
      for await (const { event, data } of sseEvents(res.body)) {
        // Свои кадры Hermes (ход инструментов, статус) и конец потока — не текст ответа.
        if (event !== 'message' || data === '[DONE]') continue;
        const chunk = JSON.parse(data) as HermesBody;
        if (failed(chunk)) error = chunk.hermes?.error ?? 'agent error';
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) onText?.((content += delta));
      }
    } else {
      const body = (await res.json()) as HermesBody;
      if (failed(body)) error = body.hermes?.error ?? 'agent error';
      content = body.choices?.[0]?.message?.content ?? '';
    }
    if (error) throw new Error(`${url}: ${error}`);
    if (!content.trim()) throw new Error(`${url}: empty reply`);
    return content.trim();
  } catch (e) {
    console.error(e);
    return null;
  }
}

/** Тесты подменяют `ask`. null — роль недоступна: бот ответит сам, как раньше. */
export const support = {
  /** `onText` — текст для человека по мере того, как роль его пишет (без пометок). */
  async ask(history: SupportTurn[], onText?: (text: string) => void): Promise<SupportReply | null> {
    const content = await askRole(settings.supportUrl, settings.supportKey, history, undefined, onText && ((raw) => onText(visibleSoFar(raw))));
    return content === null ? null : parseSupportReply(content);
  },
};

// Так роли hunter и host отказываются писать (agents/*/SOUL.md): повода нет или сообщение не по делу.
const SKIP_MARK = /\[\[пропустить/i;

/** Роль host (agents/host): пишет организаторам событий. Тесты подменяют `ask`. */
export const host = {
  /** null — роль недоступна или решила не писать. В ответе может быть пометка «позвать человека». */
  async ask(history: SupportTurn[], onText?: (text: string) => void): Promise<SupportReply | null> {
    const content = await askRole(settings.hostUrl, settings.hostKey, history, undefined, onText && ((raw) => onText(visibleSoFar(raw))));
    return content === null || SKIP_MARK.test(content) ? null : parseSupportReply(content);
  },
};

/** Роль hunter (agents/hunter): по вопросу из чата пишет короткий ответ с событием. Тесты подменяют `ask`. */
export const hunter = {
  /** Текст ответа; null — роль недоступна или решила не отвечать. */
  async ask(question: string): Promise<string | null> {
    const content = await askRole(settings.hunterUrl, settings.hunterKey, [{ role: 'user', content: question }]);
    return content === null || SKIP_MARK.test(content) ? null : content;
  },
};

// Обложку и ролик роль кладёт в хранилище xAI и отвечает ссылками на них; другие адреса не принимаем.
// Обложка: ссылка xAI (Grok Imagine) или картинка прямо в ответе — так Hermes отдаёт нарисованное ChatGPT (MEDIA: → data URL).
const COVER_URL = /https:\/\/files-cdn\.x\.ai\/[\w\-/.]+\.(?:png|jpe?g)|data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+/;
const VIDEO_URL = /https:\/\/files-cdn\.x\.ai\/[\w\-/.]+\.mp4/;

/** `keep` — роль посмотрела фото анонса и оставила его (`cover: keep`, agents/illustrator/skills/event-cover). */
export interface Illustration { cover_url: string | null; video_url: string | null; keep: boolean }

export const parseIllustration = (content: string): Illustration =>
  ({ cover_url: COVER_URL.exec(content)?.[0] ?? null, video_url: VIDEO_URL.exec(content)?.[0] ?? null, keep: /^cover:\s*keep\b/im.test(content) });

/** Роль illustrator (agents/illustrator): по данным события рисует обложку и ролик с неё. Тесты подменяют `ask`. */
export const illustrator = {
  /** Ссылки на обложку и ролик (чего нет — null); null — роль недоступна. Генерация идёт несколько минут. */
  async ask(task: string): Promise<Illustration | null> {
    const content = await askRole(settings.illustratorUrl, settings.illustratorKey, [{ role: 'user', content: task }], 10 * 60_000);
    return content === null ? null : parseIllustration(content);
  },
};
