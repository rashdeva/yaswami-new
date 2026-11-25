// Поиск по событиям и услугам. Строка поиска — системная, в шапке.
import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { EventRow } from '@/components/event-row';
import { State } from '@/components/state';
import { useSearch } from '@/queries';
import { colors } from '@/theme';

export default function Search() {
  const [query, setQuery] = useState('');
  const { data, error, isFetching } = useSearch(query);
  // Товары экран пока не рисует — их карточку делает #194.
  const entries = query.trim().length >= 2 ? (data?.entries ?? []).flatMap((e) => (e.type === 'product' ? [] : [e])) : [];
  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: 'Йога, массаж, покер…',
            autoCapitalize: 'none',
            hideWhenScrolling: false,
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            onCancelButtonPress: () => setQuery(''),
          },
        }}
      />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        data={entries}
        keyExtractor={(e, i) => `${e.type}-${i}`}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        renderItem={({ item: e }) => {
          if (e.type === 'event') return <View style={{ borderRadius: 16, overflow: 'hidden' }}><EventRow event={e.event} /></View>;
          return (
            <Link href={{ pathname: '/hosts/[id]', params: { id: e.host.id } }} asChild>
              <Pressable style={{ padding: 14, gap: 3, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.card }}>
                <Text style={{ color: colors.label, fontSize: 17, fontWeight: '600' }}>{e.practice.title}</Text>
                <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>{[e.host.name, e.practice.price].filter(Boolean).join(' · ')}</Text>
              </Pressable>
            </Link>
          );
        }}
        ListEmptyComponent={
          <State loading={isFetching} error={error} text={query.trim().length < 2 ? 'Что ищем? События и услуги мастеров' : 'Ничего не нашли'} />
        }
      />
    </>
  );
}
