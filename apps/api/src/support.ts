// Роль поддержки — Hermes, профиль support (agents/support): отвечает людям, которые пишут боту не анонс, а вопрос.
// Мы передаём ей переписку и получаем текст ответа; отправляет его наш бот. Сама роль никому писать не может.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { settings } from './settings.ts';

export interface SupportTurn { role: 'system' | 'user' | 'assistant'; content: string }
export interface SupportReply {
  text: string;
  /** Роль просит позвать человека: причина для «Ждут вас». null — справилась сама. */
  human: string | null;
}

const TICKET_TTL_S = 30 * 60;
const sign = (payload: string) => createHmac('sha256', settings.supportKey).update(payload).digest('base64url');

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

export function parseSupportReply(content: string): SupportReply {
  const mark = HUMAN_MARK.exec(content);
  return { text: content.replace(HUMAN_MARK, '').trim(), human: mark ? mark[1]!.trim() || 'Просит человека' : null };
}

/** Вопрос роли Hermes по её HTTP-входу. null — роль недоступна или ответила пусто. Не бросает. */
async function askRole(url: string, key: string, history: SupportTurn[], timeoutMs = 90_000): Promise<string | null> {
  try {
    const res = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'hermes-agent', messages: history }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; hermes?: { failed?: boolean; error?: string } };
    // Модель отказала (кончились кредиты, лимит) — Hermes всё равно отвечает 200, а в content кладёт текст ошибки.
    // Отправлять его человеку нельзя: это сбой роли.
    if (body.hermes?.failed || body.choices?.[0]?.finish_reason === 'error') throw new Error(`${url}: ${body.hermes?.error ?? 'agent error'}`);
    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error(`${url}: empty reply`);
    return content;
  } catch (e) {
    console.error(e);
    return null;
  }
}

/** Тесты подменяют `ask`. null — роль недоступна: бот ответит сам, как раньше. */
export const support = {
  async ask(history: SupportTurn[]): Promise<SupportReply | null> {
    const content = await askRole(settings.supportUrl, settings.supportKey, history);
    return content === null ? null : parseSupportReply(content);
  },
};

// Так роли hunter и host отказываются писать (agents/*/SOUL.md): повода нет или сообщение не по делу.
const SKIP_MARK = /\[\[пропустить/i;

/** Роль host (agents/host): пишет организаторам событий. Тесты подменяют `ask`. */
export const host = {
  /** null — роль недоступна или решила не писать. В ответе может быть пометка «позвать человека». */
  async ask(history: SupportTurn[]): Promise<SupportReply | null> {
    const content = await askRole(settings.hostUrl, settings.hostKey, history);
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
const COVER_URL = /https:\/\/files-cdn\.x\.ai\/[\w\-/.]+\.(?:png|jpe?g)/;
const VIDEO_URL = /https:\/\/files-cdn\.x\.ai\/[\w\-/.]+\.mp4/;

export interface Illustration { cover_url: string | null; video_url: string | null }

export const parseIllustration = (content: string): Illustration =>
  ({ cover_url: COVER_URL.exec(content)?.[0] ?? null, video_url: VIDEO_URL.exec(content)?.[0] ?? null });

/** Роль illustrator (agents/illustrator): по данным события рисует обложку и ролик с неё. Тесты подменяют `ask`. */
export const illustrator = {
  /** Ссылки на обложку и ролик (чего нет — null); null — роль недоступна. Генерация идёт несколько минут. */
  async ask(task: string): Promise<Illustration | null> {
    const content = await askRole(settings.illustratorUrl, settings.illustratorKey, [{ role: 'user', content: task }], 10 * 60_000);
    return content === null ? null : parseIllustration(content);
  },
};
