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
 * Одна новая тема за проход: самой частой метке-кандидату ИИ пишет гид или отказывает (синоним самой темы, формат,
 * свойство события, бренд, то, что мы не публикуем). Кандидаты двух видов: метка событий без темы — от `minEvents`
 * событий у `minHosts` организаторов (расписание одной студии — не тема), и метка внутри широкой темы («мафия»
 * в «играх») — порог выше, `splitEvents` у `splitHosts`: ИИ почти всегда находит событию какую-то тему, и без второго
 * вида список не рос бы вовсе. События тему всё равно получают только после одобрения командой.
 */
export async function curateTopics({ store, proposeTopic, minEvents = 5, minHosts = 3, splitEvents = 10, splitHosts = 5 }) {
  const candidate = (await store.topicCandidates({ minEvents, minHosts, splitEvents, splitHosts })).find((c) => !declined.has(c.tag));
  if (!candidate) return null;
  const topic = await proposeTopic(candidate);
  if (!topic || !(await store.addTopic(topic, { from: candidate.inside, tag: candidate.tag }))) {
    declined.add(candidate.tag);
    console.log(`тема из метки «${candidate.tag}»: ${topic ? `«${topic.name}» уже есть` : 'не тема'}`);
    return null;
  }
  await syncTopics({ store });
  console.log(`новая тема «${topic.name}» из метки «${candidate.tag}»${candidate.inside ? ` внутри «${candidate.inside}»` : ''} (${candidate.events_count} соб., ${candidate.hosts_count} орг.)`);
  return topic.name;
}
