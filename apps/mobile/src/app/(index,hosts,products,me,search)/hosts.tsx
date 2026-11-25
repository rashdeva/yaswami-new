// Каталог: организаторы и мастера с их услугами.
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { TOPIC_GUIDES } from '@yaswami/core';
import { State } from '@/components/state';
import { useHosts, useTopics } from '@/queries';
import { colors } from '@/theme';

export default function Hosts() {
  useTopics(); // темы из базы: перерисоваться, когда пришли
  const { data, error, isPending, refetch, isRefetching } = useHosts();
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      data={data ?? []}
      keyExtractor={(h) => h.id}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      renderItem={({ item: h }) => (
        <Link href={{ pathname: '/hosts/[id]', params: { id: h.id } }} asChild>
          <Pressable style={{ flexDirection: 'row', gap: 12, padding: 12, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.card }}>
            <Image source={h.photo_url} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.fill }} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colors.label, fontSize: 17, fontWeight: '600' }}>{h.name}</Text>
              {!!h.topics.length && (
                <Text numberOfLines={1} style={{ color: colors.secondaryLabel, fontSize: 14 }}>{h.topics.map((t) => `${TOPIC_GUIDES[t]?.emoji ?? ''} ${t}`).join('  ')}</Text>
              )}
              {!!h.summary && <Text numberOfLines={2} style={{ color: colors.secondaryLabel, fontSize: 14 }}>{h.summary}</Text>}
              {h.upcoming_count > 0 && <Text style={{ color: colors.tint, fontSize: 13 }}>Событий впереди: {h.upcoming_count}</Text>}
            </View>
          </Pressable>
        </Link>
      )}
      ListEmptyComponent={<State loading={isPending} error={error} onRetry={refetch} text="Каталог пока пуст" />}
    />
  );
}
