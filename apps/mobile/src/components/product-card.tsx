import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ProductItem } from '@yaswami/core';
import { productPlaceholder, productPrice } from '@/format';
import { colors } from '@/theme';

type Card = Pick<ProductItem, 'id' | 'title' | 'price' | 'unit' | 'category' | 'photo_url'> & { host: Pick<ProductItem['host'], 'name'> };

/** Фото товара; нет или не загрузилось — знак категории на плитке. */
export function ProductPhoto({ product, size, radius, emoji }: { product: Card; size: number | '100%'; radius: number; emoji: number }) {
  const [broken, setBroken] = useState(false);
  const box = { width: size, aspectRatio: 1, borderRadius: radius, borderCurve: 'continuous', backgroundColor: colors.fill } as const;
  if (!product.photo_url || broken) {
    return <View style={[box, { alignItems: 'center', justifyContent: 'center' }]}><Text style={{ fontSize: emoji }}>{productPlaceholder(product.category)}</Text></View>;
  }
  return <Image source={product.photo_url} style={box} contentFit="cover" transition={150} onError={() => setBroken(true)} />;
}

/** Товар плиткой для сетки в две колонки: фото, название, цена с весом, мастер. `row` — строкой, как в поиске. */
export function ProductCard({ product: p, row }: { product: Card; row?: boolean }) {
  const text = (
    <View style={{ flex: row ? 1 : undefined, gap: 3, justifyContent: 'center' }}>
      <Text numberOfLines={2} style={{ color: colors.label, fontSize: row ? 17 : 15, fontWeight: '600' }}>{p.title}</Text>
      <Text numberOfLines={1} style={{ color: colors.tint, fontSize: 14, fontWeight: '600' }}>{productPrice(p)}</Text>
      <Text numberOfLines={1} style={{ color: colors.secondaryLabel, fontSize: 13 }}>{p.host.name}</Text>
    </View>
  );
  return (
    <Link href={{ pathname: '/products/[id]', params: { id: p.id } }} asChild>
      <Pressable
        style={({ pressed }) => ({
          flex: row ? undefined : 1, flexDirection: row ? 'row' : 'column', gap: row ? 12 : 8, padding: row ? 12 : 8,
          borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.card, opacity: pressed ? 0.7 : 1,
        })}
      >
        <ProductPhoto product={p} size={row ? 64 : '100%'} radius={row ? 10 : 12} emoji={row ? 28 : 44} />
        {text}
      </Pressable>
    </Link>
  );
}
