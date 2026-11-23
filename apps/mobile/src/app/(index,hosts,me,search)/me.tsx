// «Мои»: вход, мои события и записи, выход и удаление аккаунта (его требует App Store).
import * as AppleAuthentication from 'expo-apple-authentication';
import { Link } from 'expo-router';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { ApiError } from '@/api';
import { Button } from '@/components/button';
import { EventRow } from '@/components/event-row';
import { Row, Section } from '@/components/section';
import { State } from '@/components/state';
import { when } from '@/format';
import { useMine } from '@/queries';
import { googleAvailable, useSession } from '@/session';
import { colors } from '@/theme';

export default function Me() {
  const { me, login, loggingIn } = useSession();
  if (me === undefined) return <State loading />;
  if (me) return <Mine name={me.user.first_name} />;

  const signIn = (via: 'telegram' | 'apple' | 'google') => login(via).catch((e: ApiError) => Alert.alert('Не получилось войти', e.message));
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 24, gap: 16, flexGrow: 1, justifyContent: 'center' }}>
      <Text style={{ color: colors.label, fontSize: 22, fontWeight: '700', textAlign: 'center' }}>Ваши события в одном месте</Text>
      <Text style={{ color: colors.secondaryLabel, fontSize: 16, textAlign: 'center', marginBottom: 8 }}>
        Войдите, чтобы отвечать на приглашения и видеть, куда вы записались.
      </Text>
      {process.env.EXPO_OS === 'ios' && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={25}
          style={{ height: 50 }}
          onPress={() => void signIn('apple')}
        />
      )}
      {googleAvailable && (
        <View style={{ flexDirection: 'row' }}>
          <Button plain title="Войти через Google" busy={loggingIn} onPress={() => void signIn('google')} />
        </View>
      )}
      <View style={{ flexDirection: 'row' }}>
        <Button title="Войти через Telegram" busy={loggingIn} onPress={() => void signIn('telegram')} />
      </View>
    </ScrollView>
  );
}

function Mine({ name }: { name: string }) {
  const { logout, deleteAccount } = useSession();
  const { data, error, isPending, refetch, isRefetching } = useMine(true);
  const confirmDelete = () =>
    Alert.alert('Удалить аккаунт?', 'Ваши ответы на события и записи удалятся. Отменить это нельзя.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => void deleteAccount().catch((e: ApiError) => Alert.alert(e.message)) },
    ]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: 48 }}
    >
      <Text style={{ color: colors.secondaryLabel, fontSize: 17, paddingHorizontal: 4 }}>Привет, {name}</Text>
      {!data ? <State loading={isPending} error={error} onRetry={refetch} /> : (
        <>
          {!data.events.length && !data.collected.length && (
            <Section footer="Ответьте «Пойду» или нажмите «Записаться» — событие появится здесь.">
              <Row>Пока ничего</Row>
            </Section>
          )}
          {!!data.events.length && (
            <Section title="Приглашения и мои события">
              {data.events.map(({ event, is_host, my_approval_status }) => (
                <Link key={event.id} href={{ pathname: '/events/[id]', params: { id: event.id } }} asChild>
                  <Pressable style={{ padding: 14, gap: 3 }}>
                    <Text style={{ color: colors.label, fontSize: 17, fontWeight: '600' }}>{event.name}</Text>
                    <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>
                      {when(event.start_at, event.timezone)}
                      {is_host ? ' · вы организатор' : my_approval_status === 'approved' ? ' · вы идёте' : my_approval_status === 'maybe' ? ' · думаете' : ''}
                    </Text>
                  </Pressable>
                </Link>
              ))}
            </Section>
          )}
          {!!data.collected.length && (
            <Section title="Записывался">
              {data.collected.map((e) => <EventRow key={e.id} event={e} />)}
            </Section>
          )}
        </>
      )}
      <Section>
        <Pressable onPress={() => void logout()} style={{ padding: 14 }}>
          <Text style={{ color: colors.tint, fontSize: 17 }}>Выйти</Text>
        </Pressable>
        <View style={{ height: 0.5, backgroundColor: colors.separator, marginLeft: 14 }} />
        <Pressable onPress={confirmDelete} style={{ padding: 14 }}>
          <Text style={{ color: '#FF3B30', fontSize: 17 }}>Удалить аккаунт</Text>
        </Pressable>
      </Section>
    </ScrollView>
  );
}
