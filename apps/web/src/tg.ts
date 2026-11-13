// Тонкая обёртка над Telegram.WebApp: только то, чем пользуемся. В обычном браузере объекта нет — всё молча пропускается.
import { parseStart } from './start.ts';

interface Inset { top: number; bottom: number; left: number; right: number }
interface WebApp {
  initData: string;
  initDataUnsafe: { start_param?: string };
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  requestFullscreen?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  safeAreaInset?: Inset;
  contentSafeAreaInset?: Inset;
  platform?: string;
  isVersionAtLeast(version: string): boolean;
  onEvent(event: 'themeChanged' | 'safeAreaChanged' | 'contentSafeAreaChanged' | 'fullscreenChanged', cb: () => void): void;
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
// нажатие — лёгкий удар, результат — «успех» или «ошибка»
export const haptic = {
  tap: () => safely(() => tg?.HapticFeedback.impactOccurred('light')),
  select: () => safely(() => tg?.HapticFeedback.selectionChanged()), // переключение вкладки, выбор из списка
  success: () => safely(() => tg?.HapticFeedback.notificationOccurred('success')),
  error: () => safely(() => tg?.HapticFeedback.notificationOccurred('error')),
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

// Хаптик на любое нажатие кнопки, ссылки или раскрывающегося блока — один раз, при касании. Успех/ошибка вызываются отдельно.
document.addEventListener('pointerdown', (e) => {
  const el = (e.target as Element).closest('button, a[href], summary');
  if (el && !(el as HTMLButtonElement).disabled) haptic.tap();
});
