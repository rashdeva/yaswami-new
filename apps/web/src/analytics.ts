// Аналитика действий — PostHog: клики и переходы он ловит сам (autocapture), записи сессий включаются в его настройках проекта.
// Здесь — запуск, привязка к пользователю и именованные действия для воронок. В разработке ничего не отправляется.
import posthog from 'posthog-js';
import { inTelegram, startParam, startRef, startTag, tg } from './tg.ts';

// Ключ проекта публичный по замыслу PostHog (он виден в любом браузере), поэтому лежит в коде: сборка в Docker переменных VITE_* не получает.
const KEY = 'phc_xveQ5LMXvEFu669ULn5VyuCUVaCmtsyw5feni58hxPrt';
const on = import.meta.env.PROD;
/** Откуда человек: мини-приложение в Telegram или сайт. */
const source = inTelegram ? 'telegram' : 'web';

/**
 * Именованные действия, по ним строятся воронки. Путь гостя: app_opened → feed_viewed → collected_event_viewed →
 * signup_clicked → (login_started → logged_in) → collected_signed_up → host_contacted. Гость события Ясвами:
 * app_opened → event_viewed → rsvp_submitted → link_shared. Организатор: create_opened → event_created → link_shared.
 * «Первый заход» отдельным действием не шлём: в PostHog у шага воронки есть условие «впервые для пользователя».
 */
type Action =
  | 'app_opened' | 'login_started' | 'logged_in' | 'logged_out'
  | 'feed_viewed' | 'feed_filtered' | 'collected_event_viewed' | 'signup_clicked' | 'collected_signed_up' | 'host_contacted' | 'host_channel_opened'
  | 'hosts_viewed' | 'hosts_filtered' | 'host_viewed' | 'practice_signup_clicked'
  | 'event_viewed' | 'rsvp_submitted' | 'link_shared'
  | 'my_events_viewed' | 'create_opened' | 'create_denied' | 'event_created' | 'event_updated' | 'event_claimed';
type Props = Record<string, string | number | boolean | null | undefined>;

// Вход на сайте уводит со страницы; по этой отметке после возврата понимаем, что человек именно вошёл, а не вернулся со старой сессией.
const LOGIN_MARK = 'login_started';
const mark = (fn: (s: Storage) => void) => {
  try {
    fn(sessionStorage);
  } catch {
    // хранилище закрыто (приватный режим) — обойдёмся без logged_in
  }
};

export function initAnalytics() {
  if (!on) return;
  // Telegram кладёт в hash подписанные данные входа (tgWebAppData). Скрипт Telegram их уже прочитал — убираем из адреса,
  // чтобы они не ушли в PostHog вместе с адресом страницы и записью сессии.
  if (location.hash.includes('tgWebAppData')) history.replaceState(history.state, '', location.pathname + location.search);
  // ponytail: шлём напрямую на us.i.posthog.com — блокировщики рекламы это режут. Заметим потери — проксировать через наш /api.
  posthog.init(KEY, { api_host: 'https://us.i.posthog.com', defaults: '2025-05-24', person_profiles: 'identified_only' });
  // Источник — на каждом действии, чтобы любую воронку можно было разрезать; tg_platform — ios, android, tdesktop…
  posthog.register({ source, tg_platform: tg?.platform });
  // Метка из ссылки в мини-приложение (`?startapp=…-s<метка>`) — тот же `utm_source`, что PostHog сам берёт из адреса сайта:
  // воронку можно разбить по источнику одинаково для сайта и Telegram. До конца сессии, чтобы следующий заход без метки её не унаследовал.
  if (startTag) posthog.register_for_session({ utm_source: startTag });
  // С чем открыли: ссылка на собранное событие (c_<id>), на событие Ясвами или просто приложение; ref — кто позвал.
  track('app_opened', { start: !startParam ? 'none' : startParam.startsWith('c_') ? 'collected_event' : 'event', ref: startRef, tag: startTag });
}

/** Привязывает действия к пользователю: id в PostHog — Telegram id, тот же, что в админке. `null` — не вошёл. */
export function identify(user: { id: number; first_name: string; username: string | null; features: string[] } | null) {
  if (!on) return;
  if (!user) return void (posthog._isIdentified() && posthog.reset());
  // В карточке человека: кто это, что ему открыто (по `features` в PostHog строятся когорты — например, организаторы),
  // откуда заходил в последний раз и в первый, и ссылка на его карточку в нашей админке.
  posthog.identify(
    String(user.id),
    { name: user.first_name, username: user.username, features: user.features, source, admin_url: `${location.origin}/admin/users/${user.id}` },
    { first_source: source, ...(startTag ? { first_utm_source: startTag } : {}) },
  );
  mark((s) => {
    if (!s.getItem(LOGIN_MARK)) return;
    s.removeItem(LOGIN_MARK);
    track('logged_in');
  });
}

export function track(action: Action, props?: Props) {
  if (!on) return;
  if (action === 'login_started') mark((s) => s.setItem(LOGIN_MARK, '1'));
  posthog.capture(action, props);
}

/** Значение флага PostHog; `fallback` — пока флаги не пришли, если PostHog недоступен и в разработке. Экраны берут его через `useFlag`. */
export function flag<T extends boolean | string>(name: string, fallback: T): T {
  const value = on ? posthog.getFeatureFlag(name) : undefined;
  return typeof value === typeof fallback ? (value as T) : fallback;
}

/** Подписка на приход и смену флагов; возвращает отписку. */
export const onFlags = (cb: () => void) => (on ? posthog.onFeatureFlags(cb) : () => {});
