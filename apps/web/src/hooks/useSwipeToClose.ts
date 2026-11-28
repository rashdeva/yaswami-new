import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

const AXIS_LOCK = 10; // столько пикселей пальцу дают решить, листает он вбок или тянет вверх-вниз
const DISTANCE = 0.18; // протянули на такую долю экрана — закрываем
const SPEED = 0.6; // или смахнули быстрее, пикселей в миллисекунду
const LEAVE_MS = 200;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Свайп вверх или вниз закрывает полноэкранный просмотр, как в Telegram и Instagram: кадр едет за пальцем, фон гаснет.
 * Только палец и стилус: мышью закрывают крестиком, Esc и щелчком мимо кадра. Вбок жест не трогает — там листает
 * прокрутка ленты (у неё `touch-action: pan-x`, поэтому вертикальное движение браузер отдаёт нам).
 * Пока палец едет, React не перерисовывает: сдвиг пишется прямо в CSS-переменные `--dy` и `--shade` корня.
 */
export function useSwipeToClose(onClose: () => void) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; axis: 'x' | 'y' | null; lastY: number; lastT: number; v: number } | null>(null);
  const dragged = useRef(false); // после протяжки щелчок мимо кадра не должен закрывать
  const leaving = useRef(false);

  const set = (dy: number, animate: boolean) => {
    const el = root.current;
    if (!el) return;
    el.style.setProperty('--dy', `${dy}px`);
    el.style.setProperty('--shade', String(Math.max(0, 1 - Math.abs(dy) / (el.clientHeight * 0.6))));
    // Пока палец ведёт — без перехода, чтобы кадр не отставал; отпустили — доезжает плавно.
    if (animate) el.dataset.settling = '';
    else delete el.dataset.settling;
  };

  /** Закрыть с уходом: `direction` 1 — кадр уезжает вниз, -1 — вверх, 0 — просто гаснет (крестик, щелчок мимо кадра). */
  function close(direction: number) {
    if (leaving.current) return;
    leaving.current = true;
    if (reducedMotion() || !root.current) return onClose();
    set(direction * root.current.clientHeight, true);
    root.current.dataset.leaving = '';
    setTimeout(onClose, LEAVE_MS);
  }

  function onPointerDown(e: ReactPointerEvent) {
    e.stopPropagation(); // просмотр может лежать в шторке vaul (портал, но дерево React общее): её жест тут ни при чём
    if (e.pointerType === 'mouse' || !e.isPrimary || leaving.current) return;
    dragged.current = false;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
  }

  function onPointerMove(e: ReactPointerEvent) {
    e.stopPropagation();
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK) return;
      d.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      // Палец может уйти за край кадра — события всё равно наши. Указатель уже отпущен — захватывать нечего, не страшно.
      if (d.axis === 'y') try { root.current?.setPointerCapture(e.pointerId); } catch { /* указателя уже нет */ }
    }
    if (d.axis !== 'y') return;
    dragged.current = true;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    set(dy, false);
  }

  function onPointerUp(e: ReactPointerEvent) {
    e.stopPropagation();
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.axis !== 'y') return;
    const dy = e.clientY - d.y;
    const height = root.current?.clientHeight ?? window.innerHeight;
    // Быстрый взмах засчитываем, только если он в ту же сторону, куда уже протянули: иначе это передумали и вернули.
    if (Math.abs(dy) > height * DISTANCE || (Math.abs(d.v) > SPEED && Math.sign(d.v) === Math.sign(dy))) close(Math.sign(dy));
    else set(0, true);
  }

  // Браузер забрал жест себе (палец пошёл вбок — листает ленту): кадр возвращаем на место.
  function onPointerCancel(e: ReactPointerEvent) {
    e.stopPropagation();
    if (drag.current?.id !== e.pointerId) return;
    if (drag.current.axis === 'y') set(0, true);
    drag.current = null;
  }

  function onClickCapture(e: ReactMouseEvent) {
    if (!dragged.current) return;
    dragged.current = false;
    e.stopPropagation();
  }

  return { root, close, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture } };
}
