// События, собранные до появления полей «что это мне даст» (topic и др.), разбираем заново по сохранённому
// анонсу и дописываем только эти поля: остальное уже могло быть дополнено повторными анонсами.
import { OTHER_TOPIC } from '@yaswami/core';
import { isSameEvent } from '@yaswami/extract';

const FIELDS = ['topic', 'what_happens', 'for_whom', 'beginner_friendly', 'takeaway'];

export async function backfillTopics({ store, extract, pause }) {
  const byAnnouncement = Map.groupBy(await store.withoutTopic(), (row) => row.announcement.id);
  for (const rows of byAnnouncement.values()) {
    // ИИ бывает перегружен на одном запросе и отвечает на следующем: сбой одного анонса не останавливает остальные,
    // а пропущенный остаётся без topic и попадёт в следующий проход.
    const events = await extract(rows[0].announcement).catch((e) => console.error(`дозаполнение ${rows[0].announcement.id}: ${e.message}`));
    await pause();
    if (!events) continue;
    for (const row of rows) {
      // Повторный разбор события не нашёл — ставим «другое», чтобы не разбирать его при каждом запуске.
      const fresh = events.find((e) => isSameEvent(row.event, e)) ?? { topic: OTHER_TOPIC };
      const patch = Object.fromEntries(FIELDS.filter((k) => k in fresh).map((k) => [k, fresh[k]]));
      await store.setEvent(row.external_id, { ...row.event, ...patch });
      console.log(`${row.external_id}: дозаполнено, topic=${patch.topic}`);
    }
  }
}
