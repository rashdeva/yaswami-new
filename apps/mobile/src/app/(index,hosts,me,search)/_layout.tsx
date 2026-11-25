// Стек каждой вкладки. Экраны события и организатора общие: открываются поверх любой вкладки.
import { Stack } from 'expo-router/stack';
import { colors } from '@/theme';

// Стартовый экран каждой вкладки: без этого все копии общего стека открывались бы с витрины.
export const unstable_settings = {
  anchor: 'index',
  hosts: { anchor: 'hosts' },
  me: { anchor: 'me' },
  search: { anchor: 'search' },
};

const TITLES: Record<string, string> = { index: 'События', hosts: 'Услуги', me: 'Мои', search: 'Поиск' };

export default function Layout({ segment }: { segment: string }) {
  const screen = segment.match(/\((.*)\)/)?.[1] ?? 'index';
  return (
    <Stack
      screenOptions={{
        headerTransparent: process.env.EXPO_OS === 'ios',
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerLargeStyle: { backgroundColor: 'transparent' },
        headerBlurEffect: 'none',
        headerBackButtonDisplayMode: 'minimal',
        headerTitleStyle: { color: colors.label },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {/* Корень вкладки — первым: он открывается при выборе вкладки. Остальные корни — с заголовком на случай перехода по ссылке. */}
      <Stack.Screen name={screen} options={{ title: TITLES[screen], headerLargeTitleEnabled: true }} />
      {Object.keys(TITLES).filter((n) => n !== screen).map((n) => <Stack.Screen key={n} name={n} options={{ title: TITLES[n] }} />)}
      <Stack.Screen name="e/[id]" options={{ title: '' }} />
      <Stack.Screen name="events/[id]" options={{ title: '' }} />
      <Stack.Screen name="hosts/[id]" options={{ title: '' }} />
    </Stack>
  );
}
