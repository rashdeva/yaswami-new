// Событие Ясвами: гость отвечает «Пойду / Думаю / Не пойду» прямо здесь. Смотреть его можно только вошедшим.
import { Image } from 'expo-image';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, Text, View } from 'react-native';
import type { RsvpStatus } from '@yaswami/core';
import { ApiError } from '@/api';
import { Button } from '@/components/button';
import { Row, Section } from '@/components/section';
import { State } from '@/components/state';
import { when } from '@/format';
import { useEvent } from '@/queries';
import { useSession } from '@/session';
import { colors } from '@/theme';

const ANSWERS: [RsvpStatus, string][] = [['approved', 'Пойду'], ['maybe', 'Думаю'], ['declined', 'Не пойду']];

export default function EventPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useSession();
  if (me === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
        <Text style={{ color: colors.secondaryLabel, fontSize: 17, textAlign: 'center' }}>Войдите, чтобы ответить на приглашение</Text>
        <Link href="/me" style={{ color: colors.tint, fontSize: 17, fontWeight: '600' }}>Войти</Link>
      </View>
    );
  }
  return <EventBody id={id} />;
}

function EventBody({ id }: { id: string }) {
  const { data: view, error, refetch, rsvp, answering } = useEvent(id);
  if (!view) return <State loading error={error} onRetry={refetch} />;
  const { event, guests, guest_counts, host, me } = view;
  const tickets = view.ticket_types.filter((t) => !t.is_hidden);
  const place = event.geo_address_json?.address;

  const answer = (approval_status: RsvpStatus, event_ticket_type_id?: string) =>
    rsvp({ approval_status, event_ticket_type_id }).catch((e: ApiError) => Alert.alert(e.message));
  function go() {
    // Несколько билетов — человек выбирает свой в системном диалоге.
    if (tickets.length < 2) return void answer('approved', tickets[0]?.id);
    Alert.alert('Какой билет?', undefined, [
      ...tickets.map((t) => ({ text: [t.name, t.price_text].filter(Boolean).join(' · '), onPress: () => void answer('approved', t.id) })),
      { text: 'Отмена', style: 'cancel' as const },
    ]);
  }

  return (
    <>
      <Stack.Screen options={{ title: event.name }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 48 }}>
        {view.cover_url && <Image source={view.cover_url} style={{ width: '100%', aspectRatio: 4 / 5, borderRadius: 24, borderCurve: 'continuous' }} transition={200} />}
        <View style={{ gap: 6 }}>
          <Text selectable style={{ color: colors.label, fontSize: 28, fontWeight: '700' }}>{event.name}</Text>
          <Text selectable style={{ color: colors.label, fontSize: 17 }}>{when(event.start_at, event.timezone)}</Text>
          {!!place && <Text selectable style={{ color: colors.secondaryLabel, fontSize: 17 }}>📍 {place}</Text>}
          <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>Организатор: {host.first_name}</Text>
        </View>
        {event.status === 'published' && !view.is_host && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {ANSWERS.map(([status, label]) => (
              <Button
                key={status}
                title={label}
                plain={me?.approval_status !== status}
                busy={answering}
                onPress={() => (status === 'approved' ? go() : void answer(status))}
              />
            ))}
          </View>
        )}
        {!!event.description && <Section><Row>{event.description}</Row></Section>}
        <Section title={`Гости · ${guest_counts.approved}${event.max_capacity ? ` из ${event.max_capacity}` : ''}`}>
          {guests.length === 0 && <Row>Пока никто не ответил</Row>}
          {guests.map((g, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }}>
              <Image source={g.user_photo_url} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.fill }} />
              <Text style={{ flex: 1, color: colors.label, fontSize: 16 }}>{g.user_first_name}{g.plus_ones ? ` +${g.plus_ones}` : ''}</Text>
              {g.approval_status === 'maybe' && <Text style={{ color: colors.secondaryLabel }}>думает</Text>}
            </View>
          ))}
        </Section>
      </ScrollView>
    </>
  );
}
