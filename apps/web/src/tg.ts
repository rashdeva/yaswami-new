// Тонкая обёртка над Telegram.WebApp: только то, чем пользуемся. В обычном браузере объекта нет — всё молча пропускается.
interface WebApp {
  initData: string;
  initDataUnsafe: { start_param?: string };
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  onEvent(event: 'themeChanged', cb: () => void): void;
  openTelegramLink(url: string): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium'): void;
    notificationOccurred(type: 'success' | 'error'): void;
    selectionChanged(): void;
  };
}

export const tg = (window as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;
/** Открыты внутри Telegram: есть подписанные данные для входа. */
export const inTelegram = !!tg?.initData;
/** Нативная кнопка «назад» в шапке Telegram. Без неё рисуем свою на странице. */
export const nativeBack = inTelegram && !!tg?.isVersionAtLeast('6.1');
/** Событие, с которым открыли приложение: t.me/<бот>/<приложение>?startapp=<id>. В браузере — ?startapp=<id>. */
export const startParam = tg?.initDataUnsafe.start_param ?? new URLSearchParams(location.search).get('startapp') ?? undefined;

const safely = (fn: () => void) => {
  try {
    fn();
  } catch {
    // старый клиент или десктоп без вибрации
  }
};
// выбор значения — «щелчок», действие — лёгкий удар, результат — «успех» или «ошибка»
export const haptic = {
  select: () => safely(() => tg?.HapticFeedback.selectionChanged()),
  tap: () => safely(() => tg?.HapticFeedback.impactOccurred('light')),
  success: () => safely(() => tg?.HapticFeedback.notificationOccurred('success')),
  error: () => safely(() => tg?.HapticFeedback.notificationOccurred('error')),
};

/** Тема: внутри Telegram — его собственная (может не совпадать с системной), в браузере — системная. */
export function syncTheme() {
  const apply = () => {
    const dark = tg?.colorScheme ? tg.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  };
  apply();
  safely(() => tg?.onEvent('themeChanged', apply));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
}
