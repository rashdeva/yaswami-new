// Темы (Topic) живут в базе. Каждый проход сборщик берёт их оттуда — так он видит тему, которую команда добавила
// минуту назад, — и сам добавляет новые: метка (Tag), накопившаяся у событий без темы, становится темой.
import { setTopics } from '@yaswami/core';

/** Реестр ядра (TOPIC_GUIDES) — из базы: по нему разбор анонса выбирает тему. Пустой ответ реестр не трогает. */
export async function syncTopics({ store }) {
  const topics = await store.topics();
  if (topics.length) setTopics(topics.map((t) => ({ ...t, icon_url: null })));
  return topics.length;
}

// Метки, по которым ИИ уже ответил «не тема».
// ponytail: в памяти процесса — после перезапуска спросим ещё раз, по одной за проход; если станет дорого — таблица.
const declined = new Set();

/**
 * Одна новая тема за проход: самой частой метке-кандидату ИИ пишет гид или отказывает (свойство события, бренд,
 * то, что мы не публикуем). Порог — `minEvents` событий у `minHosts` организаторов: расписание одной студии — не тема.
 * События тему всё равно получают только после одобрения командой: новая тема сама ничего не публикует.
 */
export async function curateTopics({ store, proposeTopic, minEvents = 5, minHosts = 3 }) {
  const candidate = (await store.topicCandidates(minEvents, minHosts)).find((c) => !declined.has(c.tag));
  if (!candidate) return null;
  const topic = await proposeTopic(candidate);
  if (!topic || !(await store.addTopic(topic))) {
    declined.add(candidate.tag);
    console.log(`тема из метки «${candidate.tag}»: ${topic ? `«${topic.name}» уже есть` : 'не тема'}`);
    return null;
  }
  await syncTopics({ store });
  console.log(`новая тема «${topic.name}» из метки «${candidate.tag}» (${candidate.events_count} соб., ${candidate.hosts_count} орг.)`);
  return topic.name;
}
