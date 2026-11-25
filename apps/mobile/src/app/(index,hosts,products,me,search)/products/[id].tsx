// Страница товара: фото, цена, мастер и «Написать» — чат мастера с готовым текстом и ссылкой на товар.
import { Image } from 'expo-image';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { ProductPhoto } from '@/components/product-card';
import { Row, Section } from '@/components/section';
import { State } from '@/components/state';
import { PRODUCT_CATEGORY_LABELS, productPrice } from '@/format';
import { useProduct } from '@/queries';
import { colors } from '@/theme';

export default function Product() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: p, error, refetch } = useProduct(id);
  if (!p) return <State loading error={error} onRetry={refetch} />;
  return (
    <>
      <Stack.Screen options={{ title: p.title }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 48 }}>
        <ProductPhoto product={p} size="100%" radius={20} emoji={72} />
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.secondaryLabel, fontSize: 13, textTransform: 'uppercase' }}>{PRODUCT_CATEGORY_LABELS[p.category]}</Text>
          <Text selectable style={{ color: colors.label, fontSize: 28, fontWeight: '700' }}>{p.title}</Text>
          <Text selectable style={{ color: colors.tint, fontSize: 19, fontWeight: '600' }}>{productPrice(p)}</Text>
        </View>
        <View style={{ flexDirection: 'row' }}><Button title="Написать" onPress={() => void Linking.openURL(p.contact_url)} /></View>
        {!!p.description && <Section><Row>{p.description}</Row></Section>}
        <Section title="Мастер">
          <Link href={{ pathname: '/hosts/[id]', params: { id: p.host.id } }} asChild>
            <Pressable style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, opacity: pressed ? 0.6 : 1 })}>
              <Image source={p.host.photo_url} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.fill }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.label, fontSize: 17, fontWeight: '600' }}>{p.host.name}</Text>
                <Text style={{ color: colors.secondaryLabel, fontSize: 14 }}>@{p.host.username}</Text>
              </View>
              <Text style={{ color: colors.secondaryLabel, fontSize: 20 }}>›</Text>
            </Pressable>
          </Link>
        </Section>
        <Section footer="Наличие на сегодня, цену и доставку уточняйте у мастера — заказ принимает он сам.">
          <Pressable onPress={() => void Linking.openURL(p.source_url)} style={({ pressed }) => ({ padding: 14, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: colors.tint, fontSize: 16 }}>Пост мастера в Telegram</Text>
          </Pressable>
        </Section>
      </ScrollView>
    </>
  );
}
