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

/** Заполняет main.ts из окружения; тесты подменяют `ask`. */
export const support = {
  /** null — роль недоступна или ответила пусто: бот ответит сам, как раньше. Не бросает. */
  async ask(history: SupportTurn[]): Promise<SupportReply | null> {
    try {
      const res = await fetch(`${settings.supportUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${settings.supportKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'hermes-agent', messages: history }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`support: HTTP ${res.status}`);
      const content = ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('support: empty reply');
      return parseSupportReply(content);
    } catch (e) {
      console.error(e);
      return null;
    }
  },
};
