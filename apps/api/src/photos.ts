// Фото, которые храним у себя, — в Postgres (ADR-0003). Сюда попадают только готовые превью Telegram, оригиналов нет.
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { photos } from './db/schema.ts';
import { settings } from './settings.ts';

/** Адрес фото для фронта. Строка фото не меняется, поэтому адрес кэшируется навсегда. */
export const photoUrl = (id: string) => `${settings.publicUrl}/api/photos/${id}`;

export async function getPhoto(db: Db, id: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select({ data: photos.data }).from(photos).where(eq(photos.id, id));
  return row?.data ?? null;
}

// Аватар из initData: адрес подписан Telegram, но качаем только с t.me — сервер не ходит по произвольным адресам.
const USERPIC = /^https:\/\/t\.me\/i\/userpic\/320\/[\w-]+\.(jpg|jpeg|svg)$/;
const MAX_BYTES = 200_000; // превью 320px весит 10–30 КБ; больше — это не оно
const REFRESH_DAYS = 7;
// ponytail: что уже проверено — помним в памяти процесса: одна проверка на пользователя до перезапуска.
// Сменил аватар под тем же адресом — подхватим после выкладки, когда фото старше REFRESH_DAYS.
const checked = new Map<number, string>();

/** Сохраняет аватар пользователя, если его ещё нет или он устарел. Не бросает: без фото остаётся кружок с буквой. */
export async function saveUserPhoto(db: Db, userId: number, url: string): Promise<void> {
  if (!USERPIC.test(url) || checked.get(userId) === url) return;
  if (checked.size > 10_000) checked.clear();
  checked.set(userId, url);
  try {
    const [fresh] = await db.select({ id: photos.id }).from(photos)
      .where(and(eq(photos.user_id, userId), eq(photos.source, url), gt(photos.created_at, sql`now() - make_interval(days => ${REFRESH_DAYS})`)));
    if (fresh) return;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    // У человека без аватара Telegram отдаёт svg с буквой — такой рисуем сами.
    if (!res.ok || res.headers.get('content-type') !== 'image/jpeg') return;
    const data = Buffer.from(await res.arrayBuffer());
    if (!data.length || data.length > MAX_BYTES) return;
    await db.transaction(async (tx) => {
      await tx.delete(photos).where(eq(photos.user_id, userId));
      await tx.insert(photos).values({ user_id: userId, source: url, data });
    });
  } catch (e) {
    checked.delete(userId);
    console.error('user photo:', (e as Error).message);
  }
}
