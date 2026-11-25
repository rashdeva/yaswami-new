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

import { messageUrl } from './address.mjs';
import { pickOffers } from './offers.mjs';

// Чем занимается человек: первое совпавшее слово — тема (по корню).
export const TOPIC = /(?<![а-яёa-z])(бачат|сальс|кизомб|танц|йог|медитац|квиз|настолк|покер|мафи[яюи]|волейбол|футбол|баскетбол|падел|теннис|бег|пробежк|сёрф|серф|фридайв|дайв|нетворкинг|митап|лекци|мастер[- ]класс|экскурси|вечеринк|тусовк|концерт|караоке|стендап|кино|bachata|salsa|yoga|quiz|poker|volleyball|basketball|tennis|surf|party|meetup)[а-яёa-z]*/i;
// Ищет компанию или партнёра на занятие: вместе с темой — самый тёплый сигнал.
const SEEK = /(ищу|ищем|нужен|нужна)\s+(партн[её]р|пару|компани|напарни|с\s+кем)|кто\s+(играет|ходит|танцует|занимается|катает|бегает|со\s+мной|хочет|пойд[её]т|ид[её]т)|с\s+кем\s+(можно\s+|бы\s+)?(сходить|пойти|поиграть|потанцевать)|looking\s+for\s+(a\s+)?(partner|buddy|company)|anyone\s+(play|going|want)/i;
// Только приехал, хочет знакомиться: слабый сигнал, роль пишет, только если есть что-то по теме.
const NEWCOMER = /(только|недавно)\s+(приехал|переехал|прилетел)|хочу\s+(познакомиться|найти\s+друзей)|new\s+(here|in\s+town)|just\s+(moved|arrived)/i;

// Просит посоветовать мастера или услугу: «посоветуйте массажиста», «ищу тренера по теннису», «кто учит английскому».
// ponytail: наивный список услуг — те, что бывают в каталоге (Practice); расширять по тому, что реально просят. Есть ли
// подходящий мастер, решает охотник: нет — пропустит. «Ищу няню» сюда не входит: это наём, а не услуга из каталога.
const SERVICE = /(?<![а-яёa-z])(массаж|остеопат|мануальн|тренер|инструктор|репетитор|преподавател|учител[яьюе]|уроки|психолог|психотерапевт|коуч|логопед|маникюр|педикюр|парикмахер|косметолог|визажист|тату|фотограф|нутрициолог|massage|coach|tutor|teacher|trainer)/i;
const REQUEST = /посоветуйте|подскажите|порекомендуйте|(?<![а-яё])(ищу|ищем|нужен|нужна|нужны)(?![а-яё])|кто\s+(знает|может\s+посоветовать|делает|учит|занимается)|есть\s+(ли\s+)?(тут|здесь|у\s+кого|кто)|recommend|looking\s+for/i;
// Ищет, где купить то, что делают мастера: «где купить творог», «кто печёт торты на заказ» — Товары из каталога (products).
// ponytail: наивный список — то, что нашлось у мастеров Дананга и в вопросах (docs/research/makers-market-danang.md,
// product-categories-2026-11.md); есть ли подходящий
// товар, решает охотник: нет — пропустит.
const PRODUCT = /(?<![а-яёa-z])(торт|бенто|пирож|выпечк|десерт|эклер|чизкейк|медовик|хлеб|закваск|творог|творож|кефир|сметан|сыр(?![ьо])|сырник|йогурт|пельмен|вареник|блин|котлет|голубц|полуфабрикат|колбас|джерки|сало(?![а-яё])|квашен|соленья|мёд|фермерск|комбуч|мыло|свеч|серьг|браслет|украшени|керамик|ручной\s+работ|хендмейд|handmade|cake|bread|sourdough|cheese|kombucha)/i;
const BUY = /где\s+(тут\s+|здесь\s+|можно\s+|в\s+дананге\s+)?(купить|взять|заказать|найти|достать)|кто\s+(печ[её]т|готовит|делает|продаёт|продает)|на\s+заказ|where\s+(to|can\s+i)\s+(buy|get|order)/i;
// Наём («ищем тренера в студию, график 5/2») и поиск работы («ищу работу тренером») — не просьба об услуге.
const HIRING = /график\s+работы|з\/п|зарплат|резюме|в\s+((нашу|свою)\s+)?команду|hiring|(?<![а-яё])ищу\s+(работу|подработку)|в\s+поиске\s+работы/i;

/**
 * Какой сигнал в сообщении: seek — ищет компанию на занятие; service — просит посоветовать мастера;
 * product — ищет, где купить то, что делают мастера (торт, творог, пельмени, хендмейд);
 * ask — «куда сходить»; newcomer — только приехал; иначе null. Длинное (объявления, истории) — не сигнал.
 */
export function signalOf(text) {
  if (text.length > 500) return null;
  if (SEEK.test(text) && TOPIC.test(text)) return 'seek';
  if (text.length <= 300 && REQUEST.test(text) && SERVICE.test(text) && !HIRING.test(text)) return 'service';
  if (text.length <= 300 && (BUY.test(text) || REQUEST.test(text)) && PRODUCT.test(text) && !HIRING.test(text)) return 'product';
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
    if (!msg.message || msg.sender?.className !== 'User' || msg.sender.bot) return [];
    const signal = now - msg.date * 1000 <= maxAgeMs && signalOf(msg.message);
    if (!signal) return [];
    return [{ signal, ...aboutMessage(chat, msg), context: messages.slice(Math.max(0, i - CONTEXT), i).map((m) => m.message).filter(Boolean).map((t) => t.slice(0, 1000)) }];
  });
}

/** Когда, где и кто написал: общее у вопроса «куда сходить» и Находки по Запросу организатора. */
function aboutMessage(chat, msg) {
  const sender = msg.sender;
  return {
    sent_at: new Date(msg.date * 1000).toISOString(),
    chat,
    message_id: msg.id,
    url: messageUrl(chat, msg.id),
    author: { id: Number(sender.id), name: [sender.firstName, sender.lastName].filter(Boolean).join(' ') || String(sender.id), username: sender.username ?? null },
    text: msg.message.slice(0, 1000),
  };
}

const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Сообщения, которые могут подойти под Запросы организаторов (`searches`: id, query, keywords, host_telegram_id):
 * от людей, свежие, не длиннее 500 знаков (длинное — объявления), не от самого организатора и хотя бы с одним
 * ключевым словом Запроса с начала слова. Это дешёвый отбор; подходит ли на самом деле, решает ИИ (extract, search.ts).
 */
export function pickSearchCandidates(chat, messages, searches, now = Date.now(), maxAgeMs = MAX_AGE_MS) {
  const ready = searches.filter((s) => s.keywords?.length).map((s) => ({ ...s, re: new RegExp(`(?<![а-яёa-z])(${s.keywords.map(escape).join('|')})`, 'i') }));
  if (!ready.length) return [];
  return messages.flatMap((msg) => {
    const sender = msg.sender;
    if (!msg.message || sender?.className !== 'User' || sender.bot || msg.message.length > 500 || now - msg.date * 1000 > maxAgeMs) return [];
    const fit = ready.filter((s) => s.host_telegram_id !== Number(sender.id) && s.re.test(msg.message));
    return fit.length ? [{ ...aboutMessage(chat, msg), searches: fit.map(({ id, query }) => ({ id, query })) }] : [];
  });
}

/** Что берём из сообщений чата города: людей с интересом к досугу или услуге, мастеров и кандидатов в Находки. */
export function pickFromChat(chat, messages, { searches = [] } = {}) {
  return {
    leads: pickLeads(chat, messages),
    offers: pickOffers(chat, messages),
    candidates: pickSearchCandidates(chat, messages, searches),
  };
}

/**
 * Новые сообщения чата после `afterNumber`: номер последнего, сколько их прочитано и найденное в них (pickFromChat).
 */
export async function fetchLeads(client, chat, afterNumber, options) {
  if (!client.connected) await client.connect();
  const messages = (await client.getMessages(/^-?\d+$/.test(chat) ? Number(chat) : chat, { limit: 100, minId: afterNumber })).reverse();
  return { last: messages.at(-1)?.id ?? afterNumber, read: messages.length, ...pickFromChat(chat, messages, options) };
}
