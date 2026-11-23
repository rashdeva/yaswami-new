import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { colors } from '@/theme';

/** Пустой экран: загрузка, ошибка или «ничего нет». */
export function State({ loading, error, text, onRetry }: { loading?: boolean; error?: Error | null; text?: string; onRetry?: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, minHeight: 240 }}>
      {loading && !error ? (
        <ActivityIndicator />
      ) : (
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 16, textAlign: 'center' }}>{error?.message ?? text}</Text>
      )}
      {error && onRetry && (
        <Pressable onPress={onRetry} hitSlop={12}>
          <Text style={{ color: colors.tint, fontSize: 16, fontWeight: '600' }}>Попробовать ещё раз</Text>
        </Pressable>
      )}
    </View>
  );
}
