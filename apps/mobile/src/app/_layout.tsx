// Корень: кэш запросов, тема и нативные вкладки — Liquid Glass на iOS 26, Material 3 на Android.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { NativeTabs } from 'expo-router/native-tabs';
import { useColorScheme } from 'react-native';
import { colors } from '@/theme';

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } });

export default function Layout() {
  const scheme = useColorScheme();
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
        <NativeTabs minimizeBehavior="onScrollDown" tintColor={colors.tint} labelVisibilityMode="labeled">
          <NativeTabs.Trigger name="(index)">
            <NativeTabs.Trigger.Icon sf={{ default: 'calendar', selected: 'calendar' }} md="event" />
            <NativeTabs.Trigger.Label>События</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="(hosts)">
            <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} md="groups" />
            <NativeTabs.Trigger.Label>Услуги</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="(me)">
            <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
            <NativeTabs.Trigger.Label>Мои</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
          <NativeTabs.Trigger name="(search)" role="search">
            <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
            <NativeTabs.Trigger.Label>Поиск</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        </NativeTabs>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
