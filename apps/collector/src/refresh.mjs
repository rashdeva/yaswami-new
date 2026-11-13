// События, собранные до того, как сборщик стал брать фото, видео и полное описание: разбираем публикацию заново.
// Признак «уже разобрано» — ключ media в announcement (пустой список — у публикации нет медиа).
import { isSameEvent, mergeEvents } from '@yaswami/extract';

/**
 * Не больше `limit` публикаций за проход: каждая — запрос к Telegram и к ИИ. Описание заменяется более длинным, пустые поля
 * дополняются (mergeEvents), остальное не трогаем. Сбой одной публикации не останавливает остальные: она попадёт в следующий проход.
 */
export async function refreshOld({ store, extract, fetchAlbum, downloadPhotos, saveMedia, pause, limit }) {
  const byAnnouncement = [...Map.groupBy(await store.withoutMedia(), (row) => row.announcement.id).values()].slice(0, limit);
  for (const rows of byAnnouncement) {
    const { announcement } = rows[0];
    try {
      const album = await fetchAlbum(announcement.id);
      // Публикацию удалили — разбирать нечего, отмечаем, чтобы не спрашивать снова.
      if (!album) { for (const row of rows) await store.refreshed(row.external_id, row.event, []); continue; }
      const photos = await downloadPhotos(album);
      const events = await extract({ ...announcement, images: photos.slice(0, 1).map((p) => p.data) });
      await pause();
      const media = await saveMedia(announcement, photos, album);
      if (!media) continue;
      for (const row of rows) {
        const fresh = events.find((e) => isSameEvent(row.event, e));
        await store.refreshed(row.external_id, fresh ? mergeEvents(row.event, fresh) : row.event, media);
      }
      console.log(`${announcement.id}: разобрано заново, медиа ${media.length}`);
    } catch (e) {
      console.error(`повторный разбор ${announcement.id}: ${e.message}`);
    }
  }
}
