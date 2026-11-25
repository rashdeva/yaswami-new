// Аватары и фото сообщества — в Postgres (ADR-0003): готовые превью Telegram, оригиналов нет.
// Обложки событий — в бакете R2 (ADR-0011), в базе только их адрес; без бакета — тоже в Postgres.
import { createHash } from 'node:crypto';
import { and, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { collectedCoverKey } from '@yaswami/core';
import { bucket, type Bucket } from './bucket.ts';
import type { Db, Tx } from './db/client.ts';
import { photos } from './db/schema.ts';
import { settings } from './settings.ts';
import { bot } from './telegram.ts';

/** Адрес фото для фронта. Строка фото не меняется, поэтому адрес кэшируется навсегда. */
export const photoUrl = (id: string) => `${settings.publicUrl}/api/photos/${id}`;

/** Адрес фото по строке `photos`: файл в бакете — его открытый адрес, иначе — наш `/api/photos/<id>`. */
export const storedPhotoUrl = (id: string | null, url: string | null): string | null => url ?? (id ? photoUrl(id) : null);

/** Байты фото из базы или адрес в бакете, куда оно переехало (старые ссылки `/api/photos/<id>` ведут туда). */
export async function getPhoto(db: Db, id: string): Promise<{ data: Buffer | null; url: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select({ data: photos.data, url: photos.url }).from(photos).where(eq(photos.id, id));
  return row ?? null;
}

type CoverOwner = { collected_external_id: string } | { event_id: string };

/** Ключ обложки в бакете: covers/<collected|event>/<id>-<хэш>.jpg. Хэш содержимого — новый файл на каждую новую картинку. */
function coverKey(owner: CoverOwner, data: Buffer): string {
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
  return 'event_id' in owner ? `covers/event/${owner.event_id}-${hash}.jpg` : collectedCoverKey(owner.collected_external_id, hash);
}

/**
 * Сохранить обложку события вместо прежней. Есть бакет — файл ложится туда, в строке `photos` только адрес; нет — байты
 * в базе, как раньше. Прежний файл в бакете не удаляем: на него может сослаться отмена в журнале команды.
 */
export async function saveCover(tx: Db | Tx, owner: CoverOwner, source: string, data: Buffer): Promise<void> {
  const b = bucket();
  const place = b ? { url: await b.put(coverKey(owner, data), data, 'image/jpeg') } : { data };
  const where = 'event_id' in owner ? eq(photos.event_id, owner.event_id) : eq(photos.collected_external_id, owner.collected_external_id);
  const ref = 'event_id' in owner ? { event_id: owner.event_id } : { collected_external_id: owner.collected_external_id };
  await tx.delete(photos).where(where);
  await tx.insert(photos).values({ ...ref, source, ...place });
}

/**
 * Разовый перенос обложек из базы в бакет (скрипт `move-covers.ts`): кладёт байты в бакет, в строке оставляет адрес
 * и стирает байты. Аватары и фото сообщества не трогает. По одной строке: прервётся — запуск заново продолжит с того же места.
 */
export async function moveCoversToBucket(db: Db, b: Bucket): Promise<{ count: number; bytes: number }> {
  const rows = await db.select({ id: photos.id }).from(photos)
    .where(and(isNotNull(photos.data), isNull(photos.url), or(isNotNull(photos.collected_external_id), isNotNull(photos.event_id))));
  const total = { count: 0, bytes: 0 };
  for (const { id } of rows) {
    const [row] = await db.select().from(photos).where(and(eq(photos.id, id), isNotNull(photos.data)));
    if (!row?.data) continue;
    // Старые необработанные PNG сжимаем по пути: в бакете все обложки — JPEG.
    const data = row.data[0] === 0x89 ? await optimizeImage(row.data) : row.data;
    const owner: CoverOwner = row.event_id ? { event_id: row.event_id } : { collected_external_id: row.collected_external_id! };
    const url = await b.put(coverKey(owner, data), data, 'image/jpeg');
    await db.update(photos).set({ url, data: null }).where(eq(photos.id, id));
    total.count++; total.bytes += row.data.length;
  }
  return total;
}

const COVER_SIDE = 1000; // обложка показывается на всю ширину шапки; больше телефону не нужно
const COVER_QUALITY = 78;

/** Перекодирует картинку в JPEG не шире COVER_SIDE: нарисованные обложки приходят PNG на 1–3 МБ, после — 60–150 КБ. */
export const optimizeImage = (data: Buffer): Promise<Buffer> =>
  sharp(data).rotate().resize({ width: COVER_SIDE, height: COVER_SIDE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: COVER_QUALITY, mozjpeg: true }).toBuffer();

/**
 * Сжимает уже сохранённые фото тяжелее `minBytes` (скрипт `optimize-photos.ts`). Строка меняется на месте:
 * адрес фото тот же, но браузеры, уже скачавшие тяжёлую версию, держат её в кэше (immutable) — новую увидят новые посетители.
 */
export async function optimizeStoredPhotos(db: Db, minBytes = 200_000): Promise<{ count: number; before: number; after: number }> {
  const heavy = await db.select({ id: photos.id }).from(photos).where(gt(sql<number>`length(${photos.data})`, minBytes));
  const total = { count: 0, before: 0, after: 0 };
  for (const { id } of heavy) {
    const [row] = await db.select({ data: photos.data }).from(photos).where(eq(photos.id, id));
    if (!row?.data) continue;
    const data = await optimizeImage(row.data).catch(() => null);
    if (!data || data.length >= row.data.length) continue;
    await db.update(photos).set({ data }).where(eq(photos.id, id));
    total.count++; total.before += row.data.length; total.after += data.length;
  }
  return total;
}

interface PhotoSize { file_id: string; file_unique_id: string; width: number; height: number }

const SIDE = 320; // у Telegram готовые размеры аватара — 160, 320 и 640; сами не сжимаем (ADR-0003)
const MAX_BYTES = 200_000; // превью 320px весит 10–30 КБ; больше — это не оно
// ponytail: кого уже проверили — помним в памяти процесса: один запрос к Telegram на пользователя до перезапуска.
// Сменил или убрал аватар — подхватим после следующей выкладки. Чаще понадобится — проверять по дате в базе.
const checked = new Map<number, Promise<void>>();

/**
 * Сохраняет аватар пользователя из Telegram. Один путь для всех входов через Telegram: его зовёт `upsertUser`, а через
 * него — и мини-приложение, и бот, и вход с сайта. Фото бот берёт по Telegram id человека — не по users.id (ADR-0008).
 * Не бросает: без фото остаётся кружок с буквой.
 */
export function saveUserPhoto(db: Db, userId: number, telegramId: number): Promise<void> {
  let done = checked.get(userId);
  if (!done) {
    if (checked.size > 10_000) checked.clear();
    done = load(db, userId, telegramId).catch((e) => {
      checked.delete(userId); // сеть или база подвели — попробуем при следующем входе
      console.error('user photo:', (e as Error).message);
    });
    checked.set(userId, done);
  }
  return done;
}

async function load(db: Db, userId: number, telegramId: number): Promise<void> {
  if (!bot.token) return;
  const got = await bot.call('getUserProfilePhotos', { user_id: telegramId, limit: 1 });
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
