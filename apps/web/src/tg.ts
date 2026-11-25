// Тонкая обёртка над Telegram.WebApp: только то, чем пользуемся. В обычном браузере объекта нет — всё молча пропускается.
import { parseStart } from './start.ts';

interface Inset { top: number; bottom: number; left: number; right: number }
interface WebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { photo_url?: string } };
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  requestFullscreen?(): void;
  /** Не закрывать мини-приложение свайпом вниз (Bot API 7.7): иначе прокрутка ленты вверх сворачивает его. */
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  safeAreaInset?: Inset;
  contentSafeAreaInset?: Inset;
  platform?: string;
  isVersionAtLeast(version: string): boolean;
  onEvent(event: 'themeChanged' | 'safeAreaChanged' | 'contentSafeAreaChanged' | 'fullscreenChanged', cb: () => void): void;
  /** Разрешение боту писать человеку: без него сводка по подписке не дойдёт тому, кто не нажимал «Старт». */
  requestWriteAccess?(): void;
  /** Геолокация средствами Telegram (Bot API 8.0): свой запрос разрешения и настройка в профиле бота. */
  LocationManager?: {
    isInited: boolean;
    isLocationAvailable: boolean;
    isAccessRequested: boolean;
    isAccessGranted: boolean;
    init(cb?: () => void): void;
    getLocation(cb: (data: { latitude: number; longitude: number } | null) => void): void;
    openSettings(): void;
  };
  openTelegramLink(url: string): void;
  openLink(url: string): void;
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
const isMobile = ['android', 'ios'].includes((tg as { platform?: string } | undefined)?.platform ?? '');
export const nativeBack = inTelegram && !!tg?.isVersionAtLeast('6.1');
/** Событие, с которым открыли приложение: t.me/<бот>/<приложение>?startapp=<id>. В браузере — ?startapp=<id>. */
const start = parseStart(tg?.initDataUnsafe.start_param ?? new URLSearchParams(location.search).get('startapp') ?? undefined);
export const startParam = start.param;
/** id пользователя, по чьей ссылке открыли приложение. */
export const startRef = start.ref;
/** Метка источника из ссылки (`-s<метка>`): откуда человек пришёл — пост, реклама, партнёр. */
export const startTag = start.tag;

const safely = (fn: () => void) => {
  try {
    fn();
  } catch {
    // старый клиент или десктоп без вибрации
  }
};
let lastHaptic = 0;
const buzz = (fn: () => void) => {
  lastHaptic = Date.now();
  safely(fn);
};
// нажатие — лёгкий удар, результат — «успех» или «ошибка»
export const haptic = {
  tap: () => buzz(() => tg?.HapticFeedback.impactOccurred('light')),
  select: () => buzz(() => tg?.HapticFeedback.selectionChanged()), // переключение вкладки, выбор из списка
  success: () => buzz(() => tg?.HapticFeedback.notificationOccurred('success')),
  error: () => buzz(() => tg?.HapticFeedback.notificationOccurred('error')),
};

/** Тема: внутри Telegram — его собственная (может не совпадать с системной), в браузере — системная. */
export function syncTheme() {
  const apply = () => {
    const dark = tg?.colorScheme ? tg.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    // шапку, фон и нижнюю панель Telegram красим в цвет страницы — иначе в полноэкранном режиме они чёрные
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    safely(() => {
      tg?.setHeaderColor?.(bg);
      tg?.setBackgroundColor?.(bg);
      tg?.setBottomBarColor?.(bg);
    });
  };
  apply();
  safely(() => tg?.onEvent('themeChanged', apply));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
}

/** Открывает внешнюю ссылку: чат Telegram — прямо в Telegram, остальное — в браузере. Вызывать прямо из обработчика нажатия. */
export function openExternal(url: string) {
  if (inTelegram && tg) return safely(() => (/^https:\/\/t\.me\//.test(url) ? tg.openTelegramLink(url) : tg.openLink(url)));
  window.open(url, '_blank', 'noopener');
}

/** Полный экран и отступы: системные (вырез, home-индикатор) + свои у Telegram (его кнопки поверх страницы) → --inset-top/--inset-bottom. */
export function syncFullscreen() {
  safely(() => {
    if (isMobile) tg?.requestFullscreen?.(); // на десктопе полный экран не нужен
  });
  const apply = () => {
    const sum = (side: 'top' | 'bottom') => (tg?.safeAreaInset?.[side] ?? 0) + (tg?.contentSafeAreaInset?.[side] ?? 0);
    document.documentElement.style.setProperty('--inset-top', `${sum('top')}px`);
    document.documentElement.style.setProperty('--inset-bottom', `${sum('bottom')}px`);
  };
  apply();
  for (const e of ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged'] as const) safely(() => tg?.onEvent(e, apply));
}

// Хаптик на любое нажатие кнопки, ссылки или раскрывающегося блока. Именно на click, не на pointerdown:
// касание, которое оказалось скроллом или свайпом, click не даёт — и не вибрирует. Если обработчик уже дал свой хаптик, второй не нужен.
document.addEventListener('click', (e) => {
  const el = (e.target as Element).closest('button, a[href], summary');
  if (el && !(el as HTMLButtonElement).disabled && Date.now() - lastHaptic > 80) haptic.tap();
});

type Coords = { latitude: number; longitude: number };

/** Где человек: в Telegram — его запросом разрешения, иначе — браузерным. null — не разрешил или не вышло. */
export function currentPosition(): Promise<Coords | null> {
  const lm = inTelegram && tg?.isVersionAtLeast('8.0') ? tg.LocationManager : undefined;
  if (!lm) return browserPosition();
  return new Promise((resolve) => {
    const ask = () => {
      if (!lm.isLocationAvailable) return void browserPosition().then(resolve);
      // Раз уже отказал, Telegram второй раз не спросит: открываем настройку, где можно разрешить.
      if (lm.isAccessRequested && !lm.isAccessGranted) return (safely(() => lm.openSettings()), resolve(null));
      lm.getLocation((data) => resolve(data && { latitude: data.latitude, longitude: data.longitude }));
    };
    try {
      if (lm.isInited) ask();
      else lm.init(ask);
    } catch {
      void browserPosition().then(resolve);
    }
  });
}

const browserPosition = () => new Promise<Coords | null>((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(({ coords }) => resolve(coords), () => resolve(null), { timeout: 10_000, maximumAge: 3_600_000 });
});
