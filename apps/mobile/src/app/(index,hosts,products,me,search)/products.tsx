// Товары мастеров: домашняя еда и хендмейд, свежие сверху. Заказ — в чате мастера; открыто без входа.
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { ProductCategory } from '@yaswami/core';
import { PRODUCT_CATEGORIES } from '@yaswami/core';
import { ProductCard } from '@/components/product-card';
import { State } from '@/components/state';
import { PRODUCT_CATEGORY_LABELS } from '@/format';
import { useProducts } from '@/queries';
import { colors } from '@/theme';

export default function Products() {
  const [category, setCategory] = useState<ProductCategory | null>(null);
  const { products, error, isPending, refetch, isRefetching, hasNextPage, fetchNextPage, isFetchingNextPage } = useProducts(category);
  const chips: [ProductCategory | null, string][] = [[null, 'Все'], ...PRODUCT_CATEGORIES.map((c) => [c, PRODUCT_CATEGORY_LABELS[c]] as [ProductCategory, string])];
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      data={products}
      numColumns={2}
      keyExtractor={(p) => p.id}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      contentContainerStyle={{ padding: 11, paddingBottom: 32 }}
      onEndReached={() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage(); }}
      ListHeaderComponent={
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 5, paddingVertical: 8 }}>
          {chips.map(([value, label]) => (
            <Pressable
              key={label}
              onPress={() => setCategory(value === category ? null : value)}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: value === category ? colors.tint : colors.card }}
            >
              <Text style={{ color: value === category ? colors.onTint : colors.label, fontSize: 15, fontWeight: '500' }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      }
      renderItem={({ item }) => <View style={{ width: '50%', padding: 5 }}><ProductCard product={item} /></View>}
      ListFooterComponent={isFetchingNextPage ? <ActivityIndicator style={{ padding: 16 }} /> : undefined}
      ListEmptyComponent={<State loading={isPending} error={error} onRetry={refetch} text="Товаров пока нет. Загляните позже." />}
    />
  );
}
