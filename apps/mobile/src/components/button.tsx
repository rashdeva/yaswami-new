import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { colors } from '@/theme';

/** Главная кнопка экрана: капсула цвета акцента с лёгким откликом. */
export function Button({ title, onPress, busy, plain }: { title: string; onPress: () => void; busy?: boolean; plain?: boolean }) {
  return (
    <Pressable
      disabled={busy}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => ({
        flex: 1, minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20,
        backgroundColor: plain ? colors.fill : colors.tint, opacity: pressed || busy ? 0.7 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={plain ? colors.label : colors.onTint} /> : (
        <Text style={{ color: plain ? colors.label : colors.onTint, fontSize: 17, fontWeight: '600' }}>{title}</Text>
      )}
    </Pressable>
  );
}
