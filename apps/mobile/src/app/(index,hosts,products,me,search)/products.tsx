// Товары мастеров, свежие сверху; плашки — категории, где в городе что-то есть. Заказ — в чате мастера; открыто без входа.
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { ProductCategory } from '@yaswami/core';
import { ProductCard } from '@/components/product-card';
import { State } from '@/components/state';
import { productCategoryName, productPlaceholder } from '@/format';
import { useProducts } from '@/queries';
import { colors } from '@/theme';

export default function Products() {
  const [category, setCategory] = useState<ProductCategory | null>(null);
  const { products, categories, error, isPending, refetch, isRefetching, hasNextPage, fetchNextPage, isFetchingNextPage } = useProducts(category);
  // Одна категория на весь город — плашки ничего не отбирают, их нет (как в мини-приложении).
  const chips: [ProductCategory | null, string][] = categories.length > 1
    ? [[null, 'Все'], ...categories.map((c) => [c, `${productPlaceholder(c)} ${productCategoryName(c)}`] as [ProductCategory, string])]
    : [];
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      data={products}
      numColumns={2}
      keyExtractor={(p) => p.id}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      contentContainerStyle={{ padding: 11, paddingBottom: 32 }}
      onEndReached={() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage(); }}
      ListHeaderComponent={chips.length === 0 ? undefined : (
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
      )}
      renderItem={({ item }) => <View style={{ width: '50%', padding: 5 }}><ProductCard product={item} /></View>}
      ListFooterComponent={isFetchingNextPage ? <ActivityIndicator style={{ padding: 16 }} /> : undefined}
      ListEmptyComponent={<State loading={isPending} error={error} onRetry={refetch} text="Товаров пока нет. Загляните позже." />}
    />
  );
}
