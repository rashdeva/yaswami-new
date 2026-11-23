import { useQuery } from '@tanstack/react-query';
import type { TopicItem } from '@yaswami/core';
import { setTopics, TOPIC_GUIDES } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';

/** Цвета тем из базы — правилами `[data-topic]`, как у первых тем в tokens.css: новой теме правка CSS не нужна. */
function paint(topics: TopicItem[]) {
  const style = document.getElementById('topic-colors') ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: 'topic-colors' }));
  style.textContent = topics.filter((t) => /^#[0-9a-f]{6}$/i.test(t.color) && /^[a-z0-9-]+$/.test(t.slug)).map((t) => `[data-topic='${t.slug}']{--c:${t.color}}`).join('');
}

/**
 * Темы в порядке фильтров. Список живёт в базе; до ответа сервера — первые темы из сборки. Ответ кладётся в реестр
 * ядра (TOPIC_GUIDES): по нему `topicIcon` и `topicSlug` находят иконку и цвет. Экран, который их зовёт, зовёт и этот
 * хук — чтобы перерисоваться, когда темы пришли.
 */
export function useTopics(): string[] {
  useQuery({
    queryKey: keys.topics,
    queryFn: async () => {
      const topics = await api.listTopics();
      setTopics(topics);
      paint(topics);
      return topics;
    },
    staleTime: 5 * 60_000,
  });
  return Object.keys(TOPIC_GUIDES);
}
