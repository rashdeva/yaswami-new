import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import type { CollectedEventItem } from '@yaswami/core';
import { collectedBadges, collectedTime } from '@yaswami/core';
import { topicIconUrl } from '@/format';
import { colors } from '@/theme';

/** Строка собранного события: обложка или иконка темы, время, название, место и пометки. */
export function EventRow({ event }: { event: CollectedEventItem }) {
  const sub = [event.place, event.price, event.beginner_friendly && 'можно без опыта'].filter(Boolean).join(' · ');
  const time = collectedTime(event.starts_at);
  return (
    <Link href={{ pathname: '/e/[id]', params: { id: event.id } }} asChild>
        <Pressable style={{ flexDirection: 'row', gap: 12, padding: 12, backgroundColor: colors.card }}>
          <Image
            source={event.cover_url ?? topicIconUrl(event.topic)}
            contentFit={event.cover_url ? 'cover' : 'contain'}
            style={{ width: 56, height: 72, borderRadius: 10, borderCurve: 'continuous', backgroundColor: colors.fill }}
            transition={150}
          />
          <View style={{ flex: 1, gap: 3, justifyContent: 'center' }}>
            {!!time && <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontVariant: ['tabular-nums'] }}>{time}</Text>}
            <Text numberOfLines={2} style={{ color: colors.label, fontSize: 17, fontWeight: '600' }}>{event.title}</Text>
            {!!sub && <Text numberOfLines={1} style={{ color: colors.secondaryLabel, fontSize: 14 }}>{sub}</Text>}
            <Badges event={event} />
          </View>
        </Pressable>
    </Link>
  );
}

export function Badges({ event }: { event: CollectedEventItem }) {
  const badges = collectedBadges(event);
  if (!badges.length) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
      {badges.map((b) => (
        <Text key={b.kind} style={{ fontSize: 12, fontWeight: '600', color: b.kind === 'free' ? colors.good : colors.hot }}>{b.label}</Text>
      ))}
    </View>
  );
}
