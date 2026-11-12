// Поиск людей, которые спрашивают «куда сходить», в больших чатах (LEAD_CHATS) — отдельно от каналов с анонсами.
// Здесь только дешёвый отбор без ИИ: из тысяч сообщений остаются десятки. Что с ними делать, решает API
// (apps/api/src/inbox.ts, recordLead): роль hunter подбирает событие, человек утверждает ответ.

// ponytail: список слов наивный и только для русского и английского; расширять по тому, что реально спрашивают в чатах.
const ASKS = new RegExp([
  'куда[^.?!]{0,25}(сходить|пойти|податься|выбраться)',
  'чем\\s+(бы\\s+)?(заняться|занять\\s+себя)',
  'что\\s+(сегодня|завтра|на\\s+выходных|вечером)?\\s*(интересного|происходит|намечается|есть\\s+интересного)',
  '(есть|будут?)\\s+(ли\\s+)?(какие[- ]?(то|нибудь)\\s+)?(мероприятия|события|тусовки|вечеринки|движ)',
  '(посоветуйте|подскажите)[^.?!]{0,40}(куда|мероприят|событи|тусовк|активност|чем заняться)',
  'ищу\\s+(компанию|с\\s+кем)',
  'где\\s+(тут|здесь|сегодня|завтра|можно|в\\s+дананге)?[^.?!]{0,30}(потанцевать|поиграть|йог|покер|настолк|потусить|познакомиться|вечеринк|бачат|сальс|бан[яю])',
  "what'?s\\s+(on|happening)", 'where\\s+to\\s+go', 'any\\s+(events|parties|meetups)', 'things\\s+to\\s+do',
].join('|'), 'i');

// Вопрос про конкретный вид досуга: знак вопроса и слово о событии или занятии («где сегодня квиз?», «кто идёт на концерт?»).
// Слово должно начинаться с корня: иначе «дистанционно» сошло бы за танцы.
const ACTIVITY = /(?<![а-яёa-z])(мероприят|вечеринк|тусовк|тусич|концерт|фестивал|квиз|настолк|покер|мафи[яюи]|йог|танц|бачат|сальс|кизомб|нетворкинг|митап|лекци|мастер[- ]класс|экскурси|party|event|meetup|quiz)/i;

/** Похоже ли сообщение на вопрос «куда сходить»: короткое и с характерными словами. */
export const looksLikeLead = (text) =>
  text.length >= 8 && text.length <= 300 && (ASKS.test(text) || (text.includes('?') && ACTIVITY.test(text)));

const MAX_AGE_MS = 2 * 3600e3; // отвечать на вопрос двухчасовой давности поздно
const CONTEXT = 3;

/**
 * Вопросы среди сообщений чата (от старых к новым). Берём только свежие и только от людей;
 * к каждому прикладываем несколько сообщений перед ним — по ним роль поймёт, о чём шёл разговор.
 */
export function pickLeads(chat, messages, now = Date.now()) {
  return messages.flatMap((msg, i) => {
    const sender = msg.sender;
    if (!msg.message || sender?.className !== 'User' || sender.bot) return [];
    if (now - msg.date * 1000 > MAX_AGE_MS || !looksLikeLead(msg.message)) return [];
    return [{
      chat,
      message_id: msg.id,
      url: /^-?\d+$/.test(chat) ? `https://t.me/c/${chat.replace(/^-100/, '')}/${msg.id}` : `https://t.me/${chat}/${msg.id}`,
      author: { id: Number(sender.id), name: [sender.firstName, sender.lastName].filter(Boolean).join(' ') || String(sender.id), username: sender.username ?? null },
      text: msg.message,
      context: messages.slice(Math.max(0, i - CONTEXT), i).map((m) => m.message).filter(Boolean).map((t) => t.slice(0, 1000)),
    }];
  });
}

/** Новые сообщения чата после `afterNumber`: номер последнего, сколько их прочитано и найденные вопросы. */
export async function fetchLeads(client, chat, afterNumber) {
  if (!client.connected) await client.connect();
  const messages = (await client.getMessages(/^-?\d+$/.test(chat) ? Number(chat) : chat, { limit: 100, minId: afterNumber })).reverse();
  return { last: messages.at(-1)?.id ?? afterNumber, read: messages.length, leads: pickLeads(chat, messages) };
}
