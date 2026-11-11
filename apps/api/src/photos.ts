// Фото, которые храним у себя, — в Postgres (ADR-0003). Сюда попадают только готовые превью Telegram, оригиналов нет.
import { and, eq } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { photos } from './db/schema.ts';
import { settings } from './settings.ts';
import { bot } from './telegram.ts';

/** Адрес фото для фронта. Строка фото не меняется, поэтому адрес кэшируется навсегда. */
export const photoUrl = (id: string) => `${settings.publicUrl}/api/photos/${id}`;

export async function getPhoto(db: Db, id: string): Promise<Buffer | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select({ data: photos.data }).from(photos).where(eq(photos.id, id));
  return row?.data ?? null;
}

interface PhotoSize { file_id: string; file_unique_id: string; width: number; height: number }

const SIDE = 320; // у Telegram готовые размеры аватара — 160, 320 и 640; сами не сжимаем (ADR-0003)
const MAX_BYTES = 200_000; // превью 320px весит 10–30 КБ; больше — это не оно
// ponytail: кого уже проверили — помним в памяти процесса: один запрос к Telegram на пользователя до перезапуска.
// Сменил или убрал аватар — подхватим после следующей выкладки. Чаще понадобится — проверять по дате в базе.
const checked = new Map<number, Promise<void>>();

/**
 * Сохраняет аватар пользователя из Telegram. Один путь для всех входов: его зовёт `upsertUser`, а через него —
 * и мини-приложение, и бот, и вход с сайта. Фото берём через бота по id пользователя, поэтому не важно, откуда
 * человек пришёл. Не бросает: без фото остаётся кружок с буквой.
 */
export function saveUserPhoto(db: Db, userId: number): Promise<void> {
  let done = checked.get(userId);
  if (!done) {
    if (checked.size > 10_000) checked.clear();
    done = load(db, userId).catch((e) => {
      checked.delete(userId); // сеть или база подвели — попробуем при следующем входе
      console.error('user photo:', (e as Error).message);
    });
    checked.set(userId, done);
  }
  return done;
}

async function load(db: Db, userId: number): Promise<void> {
  if (!bot.token) return;
  const got = await bot.call('getUserProfilePhotos', { user_id: userId, limit: 1 });
  const all = (got.result as { photos?: PhotoSize[][] } | undefined)?.photos;
  if (!got.ok || !all) return;
  const sizes = all[0]; // размеры одного фото, от меньшего к большему
  if (!sizes?.length) {
    // Фото нет или человек скрыл его настройками приватности — у себя тоже не держим.
    await db.delete(photos).where(eq(photos.user_id, userId));
    return;
  }
  const size = sizes.find((s) => Math.max(s.width, s.height) >= SIDE) ?? sizes.at(-1)!;
  const source = `telegram:userpic/${size.file_unique_id}`;
  const [same] = await db.select({ id: photos.id }).from(photos).where(and(eq(photos.user_id, userId), eq(photos.source, source)));
  if (same) return;
  const file = await bot.call('getFile', { file_id: size.file_id });
  const path = (file.result as { file_path?: string } | undefined)?.file_path;
  if (!path) return;
  const res = await fetch(`https://api.telegram.org/file/bot${bot.token}/${path}`, { signal: AbortSignal.timeout(5000) });
  const data = Buffer.from(await res.arrayBuffer());
  if (!res.ok || data[0] !== 0xff || data[1] !== 0xd8 || data.length > MAX_BYTES) return;
  await db.transaction(async (tx) => {
    await tx.delete(photos).where(eq(photos.user_id, userId));
    await tx.insert(photos).values({ user_id: userId, source, data });
  });
}
