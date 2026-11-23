// Темы: список с выключенными, кандидаты из меток, добавить, поправить, выключить. Действия отменяются из тоста.
import { useQuery } from '@tanstack/react-query';
import type { TopicUpdateInput } from '@yaswami/core';
import { setTopics } from '@yaswami/core';
import { api } from '../api.ts';
import { keys } from './keys.ts';
import { useAct } from './useAct.ts';

const undo = (_input: unknown, topic: { name: string }) => ['topic', topic.name] as ['topic', string];

/** Список тем; заодно обновляет реестр ядра (TOPIC_GUIDES): по нему формы админки предлагают темы на выбор. */
export const useTopicList = () => useQuery({
  queryKey: keys.topics,
  queryFn: async () => {
    const topics = await api.topics();
    setTopics(topics.filter((t) => t.enabled));
    return topics;
  },
});

export function useTopics() {
  return {
    topics: useTopicList(),
    candidates: useQuery({ queryKey: keys.topicCandidates, queryFn: api.topicCandidates }),
    create: useAct(api.topicCreate, { undo }),
    update: useAct(({ name, ...input }: { name: string } & TopicUpdateInput) => api.topicUpdate(name, input), { undo }),
  };
}
