// Событие, собранное из открытого канала. Записывает организатор: мы отмечаем интерес и открываем чат с ним.
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView, Share, Text, View } from 'react-native';
import { collectedIsPast, collectedPath, collectedWhen, TOPIC_GUIDES } from '@yaswami/core';
import { SITE } from '@/api';
import { Button } from '@/components/button';
import { Badges } from '@/components/event-row';
import { Row, Section } from '@/components/section';
import { State } from '@/components/state';
import { topicIconUrl } from '@/format';
import { useCollected, useTopics } from '@/queries';
import { useSession } from '@/session';
import { colors } from '@/theme';

export default function CollectedEvent() {
  useTopics(); // темы из базы: перерисоваться, когда пришли
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: event, error, refetch, signUp } = useCollected(id);
  const { me } = useSession();
  if (!event) return <State loading error={error} onRetry={refetch} />;

  const past = collectedIsPast(event);
  const signedUp = !!me?.collected_signups.includes(id);
  const where = [event.place, event.address].filter(Boolean).join(', ');
  const guide = event.topic ? TOPIC_GUIDES[event.topic] : undefined;
  const share = () => void Share.share({ message: `${event.title}\n${collectedWhen(event.starts_at)}\n${SITE}${collectedPath(id)}` });

  function join() {
    if (event!.claimed_event_id) return router.push({ pathname: '/events/[id]', params: { id: event!.claimed_event_id } });
    if (me && !signedUp) signUp();
    void Linking.openURL(event!.signup_url);
  }

  return (
    <>
      <Stack.Screen options={{ title: event.title }} />
      {process.env.EXPO_OS === 'ios' && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="square.and.arrow.up" onPress={share} />
        </Stack.Toolbar>
      )}
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 48 }}>
        <Image
          source={event.cover_url ?? topicIconUrl(event.topic)}
          contentFit={event.cover_url ? 'cover' : 'contain'}
          style={{ width: '100%', aspectRatio: event.cover_url ? 4 / 5 : 2, borderRadius: 24, borderCurve: 'continuous', backgroundColor: colors.fill }}
          transition={200}
        />
        <View style={{ gap: 6 }}>
          {past && <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>Событие прошло</Text>}
          <Text selectable style={{ color: colors.label, fontSize: 28, fontWeight: '700' }}>{event.title}</Text>
          <Text selectable style={{ color: colors.label, fontSize: 17 }}>{collectedWhen(event.starts_at)}</Text>
          {!!where && <Text selectable style={{ color: colors.secondaryLabel, fontSize: 17 }}>📍 {where}</Text>}
          <Badges event={event} />
        </View>
        {!past && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title={signedUp && !event.claimed_event_id ? 'Написать организатору' : 'Записаться'} onPress={join} />
            {process.env.EXPO_OS !== 'ios' && <Button plain title="Поделиться" onPress={share} />}
          </View>
        )}
        {!!event.price && <Section><Row icon="🎟">{event.price}</Row></Section>}
        {!!event.description && <Section><Row>{event.description}</Row></Section>}
        {!!event.what_happens?.length && (
          <Section title="Что будет">{event.what_happens.map((s, i) => <Row key={i} icon={`${i + 1}.`}>{s}</Row>)}</Section>
        )}
        {!!event.for_whom && <Section title="Для кого"><Row>{event.for_whom}</Row></Section>}
        {!!event.takeaway && <Section title="С чем уйдёте"><Row>{event.takeaway}</Row></Section>}
        {guide && <Section title={`Если впервые: ${event.topic}`}><Row>{guide.first}</Row></Section>}
        {!!event.hosts?.length && (
          <Section title="Организатор" footer={event.signups_count ? `Интересуются: ${event.signups_count}. Записывает организатор.` : undefined}>
            {event.hosts.map((h) => (
              <View key={h.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
                <Image source={h.photo_url} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.fill }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.label, fontSize: 17, fontWeight: '600' }}>{h.name}</Text>
                  {!!h.summary && <Text numberOfLines={3} style={{ color: colors.secondaryLabel, fontSize: 14 }}>{h.summary}</Text>}
                </View>
              </View>
            ))}
          </Section>
        )}
        <Text style={{ color: colors.secondaryLabel, fontSize: 13, paddingHorizontal: 16 }} onPress={() => void Linking.openURL(event.source_url)}>
          {event.claimed_event_id
            ? 'Организатор принимает записи в Ясвами: ответьте «Пойду» — и вы в списке гостей.'
            : event.signup_url.startsWith('https://ig.me/')
              ? 'Событие нашли в Instagram организатора. Записывает он сам: откроем его директ. '
              : 'Событие нашли в открытом канале. Записывает организатор: откроем чат с ним и готовым сообщением. '}
          <Text style={{ color: colors.tint }}>Исходный анонс</Text>
        </Text>
      </ScrollView>
    </>
  );
}
