// Витрина: предстоящие события города по дням, фильтр по темам. Открыта без входа.
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, SectionList, Text, View } from 'react-native';
import { TOPIC_GUIDES } from '@yaswami/core';
import { EventRow } from '@/components/event-row';
import { State } from '@/components/state';
import { dayLabel } from '@/format';
import { useFeed } from '@/queries';
import { colors } from '@/theme';

const POPULAR = 'popular';

export default function Feed() {
  const { days, data, error, isPending, refetch, isRefetching } = useFeed();
  const [topic, setTopic] = useState<string | null>(null);
  // Предлагаем только темы, по которым есть события; порядок — как в гиде.
  const topics = Object.keys(TOPIC_GUIDES).filter((t) => data?.some((e) => e.topic === t));
  const sections = days
    .map((d) => ({ ...d, data: d.data.filter((e) => !topic || (topic === POPULAR ? e.popular : e.topic === topic)) }))
    .filter((d) => d.data.length);
  const chips = [[null, 'Все'], ...(data?.some((e) => e.popular) ? [[POPULAR, '🔥 Популярное']] : []), ...topics.map((t) => [t, `${TOPIC_GUIDES[t]!.emoji} ${t[0]!.toUpperCase()}${t.slice(1)}`])] as [string | null, string][];

  return (
    <SectionList
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={(e) => e.id}
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      contentContainerStyle={{ paddingBottom: 32 }}
      ListHeaderComponent={
        chips.length > 2 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
            {chips.map(([value, label]) => (
              <Pressable
                key={label}
                onPress={() => setTopic(value === topic ? null : value)}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: value === topic ? colors.tint : colors.card }}
              >
                <Text style={{ color: value === topic ? colors.onTint : colors.label, fontSize: 15, fontWeight: '500' }}>{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : undefined
      }
      renderSectionHeader={({ section }) => (
        <Text style={{ color: colors.label, fontSize: 20, fontWeight: '700', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 }}>
          {dayLabel(section.data[0]!.starts_at)}
        </Text>
      )}
      renderItem={({ item, index, section }) => (
        <View style={{ marginHorizontal: 16, overflow: 'hidden', borderTopLeftRadius: index === 0 ? 16 : 0, borderTopRightRadius: index === 0 ? 16 : 0, borderBottomLeftRadius: index === section.data.length - 1 ? 16 : 0, borderBottomRightRadius: index === section.data.length - 1 ? 16 : 0 }}>
          <EventRow event={item} />
          {index < section.data.length - 1 && <View style={{ height: 0.5, backgroundColor: colors.separator, marginLeft: 80 }} />}
        </View>
      )}
      ListEmptyComponent={<State loading={isPending} error={error} onRetry={refetch} text="Пока ничего не запланировано. Загляните позже." />}
    />
  );
}
