// Вакансии (Job в @yaswami/core) из чатов о работе (JOB_CHATS) и больших чатов города (LEAD_CHATS).
// Дешёвый отбор без ИИ здесь; вакансия ли это, в нашем ли городе и что в ней, решает ИИ (packages/extract, job.ts).
// Найденное ложится в jobs со статусом pending: команда одобряет в «Каталоге».
import { createHash } from 'node:crypto';

const ROLES = 'сотрудни|администратор|менеджер|помощни|ассистент|бариста|официант|повар|нян[юяьие]|преподавател|учител|тренер|фотограф|видеограф|smm|смм|дизайнер|разработчик|продав|водител|курьер|хостес|аниматор|инструктор|гид(а|ов)?(?![а-яё])|массажист|уборщи|клинер|бухгалтер|бармен|кальянщи|персонал|специалист';
// ponytail: наивный список слов, проверен на 60 тыс. сообщений чатов Дананга; хватает одного признака — лишнее отсеет ИИ.
// Если запросов к ИИ станет слишком много — требовать два признака, как в offers.mjs.
const SIGNS = [
  /ваканси/i,
  // «требуется … должность»: между ними до трёх слов без знаков препинания — иначе «(требуется бронирование). Инструктор — Анна» сошло бы за вакансию.
  new RegExp(`(?<![а-яё])(требуется|требуются|ищем|ищу|нужен|нужна|нужны|в\\s+поиске)[\\s:—–-]+([^\\s.,!?()]+[ \\t]+){0,3}(${ROLES})`, 'i'),
  /(?<![а-яё])в\s+((нашу|свою)\s+)?команду/i,
  /hiring|we\s+are\s+looking\s+for|we['’]re\s+looking\s+for|job\s+offer/i,
  /график\s+работы|з\/п|зарплат|оплата\s+(почасовая|за\s+смену)/i,
];
// Резюме: человек ищет работу сам. Такое в ИИ не отправляем.
export const RESUME = /(?<![а-яё])ищу\s+(работу|подработку|удал[её]нку)|в\s+поиске\s+(работы|подработки)|рассмотрю\s+(\S+\s+)?предложени|looking\s+for\s+(a\s+)?(job|work)|мо[её]\s+резюме/i;

/** Похоже ли сообщение на вакансию: не короткая реплика, не резюме и хотя бы один признак. */
export const looksLikeJob = (text) => text.length >= 60 && text.length <= 3000 && !RESUME.test(text) && SIGNS.some((re) => re.test(text));

/** По нему узнаём повтор объявления: регистр и пробелы работодатели меняют, текст — нет. */
export const jobTextHash = (text) => createHash('sha256').update(text.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');

/**
 * Сообщения чата, похожие на вакансию. Автор — человек (id и username, если есть); объявление от бота или от имени
 * чата — автор неизвестен, контакт возьмём из текста (saveJobs).
 */
export function pickJobs(chat, messages) {
  return messages.flatMap((m) => {
    if (!m.message || !looksLikeJob(m.message)) return [];
    const s = m.sender;
    const person = s?.className === 'User' && !s.bot;
    return [{
      url: /^-?\d+$/.test(chat) ? `https://t.me/c/${chat.replace(/^-100/, '')}/${m.id}` : `https://t.me/${chat}/${m.id}`,
      author: { id: person ? Number(s.id) : null, username: person && s.username ? s.username.toLowerCase() : null },
      text: m.message,
      posted_at: new Date(m.date * 1000),
    }];
  });
}

// Объявления, которые ИИ уже отверг (резюме, другой город): повтор в ИИ не шлём.
// ponytail: помним в памяти процесса — после перезапуска спросим ещё раз; при POLL_MINUTES=0 (cron) это надо класть в базу.
const rejected = new Set();

/** Контакт из ответа ИИ: без @ и t.me/, в нижнем регистре; не username или его нет в тексте (ИИ выдумал) — null. */
function contactFrom(username, text) {
  const u = username?.trim().replace(/^(https?:\/\/)?(t\.me\/|@)/i, '').toLowerCase();
  return u && /^\w{4,32}$/.test(u) && text.toLowerCase().includes(u) ? u : null;
}

/**
 * Разобрать объявления ИИ и сохранить вакансии города `city` ({ id, name }); возвращает, сколько новых.
 * Повтор (тот же текст в том же городе) в ИИ не идёт: только сдвигает posted_at, решение команды не трогает.
 * Контакт — из текста, иначе автор; без username вакансия не сохраняется: работодателю не написать.
 */
export async function saveJobs({ store, extractJob, pause, city }, jobs) {
  let saved = 0;
  for (const { url, author, text, posted_at } of jobs) {
    const text_hash = jobTextHash(text);
    if (rejected.has(`${city.id}:${text_hash}`) || await store.touchJob(city.id, text_hash, posted_at)) continue;
    try {
      const job = await extractJob(city.name, text);
      const telegram_username = job && (contactFrom(job.telegram_username, text) ?? author.username);
      if (telegram_username) {
        const { title, employer, description, pay } = job;
        await store.saveJob({ city_id: city.id, title, employer, description, pay, telegram_username, announcement: { url, text }, author_id: author.id, text_hash, posted_at });
        saved++;
        console.log(`вакансия «${title}» @${telegram_username} (${url})`);
      } else rejected.add(`${city.id}:${text_hash}`); // не вакансия или некому писать
    } catch (e) {
      console.error(`вакансия ${url}: ${e.status ?? ''} ${e.message.slice(0, 120)}`); // лимит ИИ и прочее: это объявление пропустим
    }
    await pause();
  }
  return saved;
}
