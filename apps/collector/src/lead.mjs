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

import { pickOffers } from './offers.mjs';

// Чем занимается человек: первое совпавшее слово — тема (по корню).
export const TOPIC = /(?<![а-яёa-z])(бачат|сальс|кизомб|танц|йог|медитац|квиз|настолк|покер|мафи[яюи]|волейбол|футбол|баскетбол|падел|теннис|бег|пробежк|сёрф|серф|фридайв|дайв|нетворкинг|митап|лекци|мастер[- ]класс|экскурси|вечеринк|тусовк|концерт|караоке|стендап|кино|bachata|salsa|yoga|quiz|poker|volleyball|basketball|tennis|surf|party|meetup)[а-яёa-z]*/i;
// Ищет компанию или партнёра на занятие: вместе с темой — самый тёплый сигнал.
const SEEK = /(ищу|ищем|нужен|нужна)\s+(партн[её]р|пару|компани|напарни|с\s+кем)|кто\s+(играет|ходит|танцует|занимается|катает|бегает|со\s+мной|хочет|пойд[её]т|ид[её]т)|с\s+кем\s+(можно\s+|бы\s+)?(сходить|пойти|поиграть|потанцевать)|looking\s+for\s+(a\s+)?(partner|buddy|company)|anyone\s+(play|going|want)/i;
// Только приехал, хочет знакомиться: слабый сигнал, роль пишет, только если есть что-то по теме.
const NEWCOMER = /(только|недавно)\s+(приехал|переехал|прилетел)|хочу\s+(познакомиться|найти\s+друзей)|new\s+(here|in\s+town)|just\s+(moved|arrived)/i;

/** Какой сигнал интереса в сообщении: seek, ask, newcomer или null. Длинное (объявления, истории) — не сигнал. */
export function signalOf(text) {
  if (text.length > 500) return null;
  if (SEEK.test(text) && TOPIC.test(text)) return 'seek';
  if (looksLikeLead(text)) return 'ask';
  return NEWCOMER.test(text) ? 'newcomer' : null;
}

// Сборщик видит сообщения раз в проход, обычно свежие. Старше суток — уже не ловим: для истории есть backfill-leads.mjs.
// Свежее ли оно для ответа в чат, решает API (LEAD_REPLY_HOURS): старое уйдёт черновиком в личку.
const MAX_AGE_MS = 24 * 3600e3;
const CONTEXT = 3;

/**
 * Люди с интересом к досугу среди сообщений чата (от старых к новым), не старше `maxAgeMs`, только от людей;
 * к каждому прикладываем несколько сообщений перед ним — по ним роль поймёт, о чём шёл разговор.
 */
export function pickLeads(chat, messages, now = Date.now(), maxAgeMs = MAX_AGE_MS) {
  return messages.flatMap((msg, i) => {
    const sender = msg.sender;
    if (!msg.message || sender?.className !== 'User' || sender.bot) return [];
    const signal = now - msg.date * 1000 <= maxAgeMs && signalOf(msg.message);
    if (!signal) return [];
    return [{
      signal,
      sent_at: new Date(msg.date * 1000).toISOString(),
      chat,
      message_id: msg.id,
      url: /^-?\d+$/.test(chat) ? `https://t.me/c/${chat.replace(/^-100/, '')}/${msg.id}` : `https://t.me/${chat}/${msg.id}`,
      author: { id: Number(sender.id), name: [sender.firstName, sender.lastName].filter(Boolean).join(' ') || String(sender.id), username: sender.username ?? null },
      text: msg.message.slice(0, 1000),
      context: messages.slice(Math.max(0, i - CONTEXT), i).map((m) => m.message).filter(Boolean).map((t) => t.slice(0, 1000)),
    }];
  });
}

/** Новые сообщения чата после `afterNumber`: номер последнего, сколько их прочитано, найденные вопросы и самопредставления мастеров. */
export async function fetchLeads(client, chat, afterNumber) {
  if (!client.connected) await client.connect();
  const messages = (await client.getMessages(/^-?\d+$/.test(chat) ? Number(chat) : chat, { limit: 100, minId: afterNumber })).reverse();
  return { last: messages.at(-1)?.id ?? afterNumber, read: messages.length, leads: pickLeads(chat, messages), offers: pickOffers(chat, messages) };
}
