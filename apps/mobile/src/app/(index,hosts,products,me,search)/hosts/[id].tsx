// Страница организатора: о нём, его услуги с записью в Telegram, товары и ближайшие события.
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { practiceSignupUrl } from '@yaswami/core';
import { Button } from '@/components/button';
import { EventRow } from '@/components/event-row';
import { ProductCard } from '@/components/product-card';
import { Row, Section } from '@/components/section';
import { State } from '@/components/state';
import { useHost } from '@/queries';
import { colors } from '@/theme';

export default function Host() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: host, error, refetch } = useHost(id);
  if (!host) return <State loading error={error} onRetry={refetch} />;
  return (
    <>
      <Stack.Screen options={{ title: host.name }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 48 }}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Image source={host.photo_url} style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.fill }} />
          <Text selectable style={{ color: colors.label, fontSize: 26, fontWeight: '700', textAlign: 'center' }}>{host.name}</Text>
          {!!host.summary && <Text selectable style={{ color: colors.secondaryLabel, fontSize: 16, textAlign: 'center' }}>{host.summary}</Text>}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="Написать" onPress={() => void Linking.openURL(host.contact_url)} />
          {host.channel_url && <Button plain title="Канал" onPress={() => void Linking.openURL(host.channel_url!)} />}
          {host.instagram_handle && <Button plain title="Instagram" onPress={() => void Linking.openURL(`https://instagram.com/${host.instagram_handle}`)} />}
        </View>
        {!!host.practices.length && (
          <Section title="Услуги">
            {host.practices.map((p) => (
              <Pressable key={p.id} onPress={() => void Linking.openURL(practiceSignupUrl(host.username, p.title))} style={({ pressed }) => ({ padding: 14, gap: 4, opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ color: colors.label, fontSize: 17, fontWeight: '600' }}>{p.title}</Text>
                {!!p.description && <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>{p.description}</Text>}
                <Text style={{ color: colors.tint, fontSize: 15 }}>{p.price ? `${p.price} · ` : ''}Записаться</Text>
              </Pressable>
            ))}
          </Section>
        )}
        {!!host.products.length && (
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.secondaryLabel, fontSize: 13, textTransform: 'uppercase', paddingHorizontal: 16 }}>Товары</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -5 }}>
              {host.products.map((p) => <View key={p.id} style={{ width: '50%', padding: 5 }}><ProductCard product={p} /></View>)}
            </View>
          </View>
        )}
        {!!host.events.length && <Section title="Ближайшие события">{host.events.map((e) => <EventRow key={e.id} event={e} />)}</Section>}
        {!!host.photos.length && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {host.photos.map((p) => (
              <Pressable key={p.url} onPress={() => void Linking.openURL(p.source_url)}>
                <Image source={p.url} style={{ width: 140, height: 180, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.fill }} />
              </Pressable>
            ))}
          </ScrollView>
        )}
        {!host.practices.length && !host.products.length && !host.events.length && <Section><Row>Скоро здесь появятся услуги и события</Row></Section>}
      </ScrollView>
    </>
  );
}
