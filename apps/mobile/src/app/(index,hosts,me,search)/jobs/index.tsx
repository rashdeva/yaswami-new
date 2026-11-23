// Вакансии из чатов о работе: свежие сверху. Пишет работодателю сам человек.
import { FlatList, RefreshControl } from 'react-native';
import { JobRow } from '@/components/job-row';
import { State } from '@/components/state';
import { useJobs } from '@/queries';

export default function Jobs() {
  const { data, error, isPending, refetch, isRefetching } = useJobs();
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      data={data?.entries ?? []}
      keyExtractor={(j) => j.id}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      renderItem={({ item }) => <JobRow job={item} />}
      ListEmptyComponent={<State loading={isPending} error={error} onRetry={refetch} text="Свежих вакансий пока нет" />}
    />
  );
}
