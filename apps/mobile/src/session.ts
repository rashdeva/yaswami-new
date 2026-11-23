// Кто вошёл: вход через Telegram или Apple, выход и удаление аккаунта. Токен живёт в api.ts.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as WebBrowser from 'expo-web-browser';
import type { Me } from '@yaswami/core';
import { api, ApiError, AUTH_REDIRECT, BASE, hasToken, setToken } from './api';
import { keys } from './keys';

/** Токен из адреса, на который сервер вернул человека: app.yaswami://auth?token=… или ?error=… */
export function tokenFromRedirect(url: string): string {
  const params = new URL(url).searchParams;
  const token = params.get('token');
  if (!token) throw new ApiError(params.get('error') ?? 'unauthorized');
  return token;
}

async function telegram(): Promise<string | null> {
  // ASWebAuthenticationSession на iOS и Custom Tabs на Android: вход в Telegram видит только браузер, не мы.
  const res = await WebBrowser.openAuthSessionAsync(`${BASE}/auth/telegram/login?app=1`, AUTH_REDIRECT);
  if (res.type !== 'success') return null;
  // Отказ в окне Telegram — не ошибка: человек передумал.
  if (new URL(res.url).searchParams.get('error') === 'cancelled') return null;
  return tokenFromRedirect(res.url);
}

async function apple(): Promise<string | null> {
  try {
    const cred = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME] });
    if (!cred.identityToken) throw new ApiError('unauthorized');
    // Имя Apple отдаёт только при первом входе — передаём, пока оно есть.
    return (await api.loginApple(cred.identityToken, cred.fullName?.givenName ?? undefined)).token;
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null;
    throw e;
  }
}

/**
 * Web client ID из Google Cloud Console: Google подписывает им id_token, сервер сверяет его с GOOGLE_CLIENT_IDS.
 * Не задан — кнопки Google нет. Вход через Google только на Android: на iOS есть Apple.
 */
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
export const googleAvailable = process.env.EXPO_OS === 'android' && !!GOOGLE_WEB_CLIENT_ID;
if (googleAvailable) GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });

async function google(): Promise<string | null> {
  await GoogleSignin.hasPlayServices();
  const res = await GoogleSignin.signIn();
  if (res.type !== 'success') return null;
  if (!res.data.idToken) throw new ApiError('unauthorized');
  // Аккаунт на устройстве не держим: следующий вход снова предложит выбрать, каким войти.
  void GoogleSignin.signOut();
  return (await api.loginGoogle(res.data.idToken)).token;
}

/** `me`: undefined — ещё выясняем, null — не вошёл. */
export function useSession() {
  const client = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: keys.me,
    queryFn: async (): Promise<Me | null> => {
      if (!hasToken()) return null;
      try {
        return await api.me();
      } catch (e) {
        // Токен отозван или просрочен — забываем его; при сетевой ошибке пусть повторит запрос.
        if ((e as ApiError).code === 'unauthorized') return (await setToken(null), null);
        throw e;
      }
    },
    staleTime: Infinity,
  });

  // Вход, выход и удаление меняют, кто смотрит: личное в кэше больше не годится.
  const reset = () => client.resetQueries();
  const login = useMutation({
    mutationFn: async (via: 'telegram' | 'apple' | 'google') => {
      const token = await { telegram, apple, google }[via]();
      if (token) await setToken(token);
      return !!token;
    },
    onSuccess: (done) => done && reset(),
  });
  const logout = useMutation({
    // ponytail: выход только забывает токен на устройстве — /auth/logout отзывает лишь cookie сайта.
    // Отзывать и Bearer-токен там, если понадобится «выйти на всех устройствах».
    mutationFn: () => setToken(null),
    onSuccess: reset,
  });
  const remove = useMutation({
    mutationFn: async () => (await api.deleteMe(), await setToken(null)),
    onSuccess: reset,
  });

  return {
    me: isPending ? undefined : data ?? null,
    login: login.mutateAsync,
    loggingIn: login.isPending,
    logout: logout.mutateAsync,
    deleteAccount: remove.mutateAsync,
  };
}
