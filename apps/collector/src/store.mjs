// Хранилище сборщика в Postgres. Таблицы описаны в apps/api/src/db/schema.ts (collected_events,
// collector_cursors) и создаются миграциями API; здесь — только запросы.
import postgres from 'postgres';

export function createStore(url) {
  const sql = postgres(url, { onnotice: () => {} });
  return {
    /** Номер последней разобранной публикации по каждому источнику. */
    async cursors() {
      const rows = await sql`select channel, last_number from collector_cursors`;
      return Object.fromEntries(rows.map((r) => [r.channel, r.last_number]));
    },
    saveCursor: (channel, number) => sql`
      insert into collector_cursors (channel, last_number) values (${channel}, ${number})
      on conflict (channel) do update set last_number = excluded.last_number`,
    /** Предстоящие события — с ними склеиваются повторные анонсы. */
    upcoming: () => sql`select external_id, event from collected_events where coalesce(ends_at, starts_at) >= now()`,
    /** Новое событие или дополнение уже известного. Публикация остаётся от первого анонса. */
    upsert: ({ external_id, channel, announcement, event, signup_url }) => sql`
      insert into collected_events ${sql({
        external_id, channel, signup_url,
        announcement: sql.json(announcement),
        event: sql.json(event),
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        telegram_username: event.telegram_username?.replace(/^@/, '').toLowerCase() ?? null,
      })}
      on conflict (external_id) do update set
        event = excluded.event, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
        telegram_username = excluded.telegram_username, signup_url = excluded.signup_url, updated_at = now()`,
    /** Предстоящие события без полей «что это мне даст»: собраны до их появления. */
    withoutTopic: () => sql`
      select external_id, announcement, event from collected_events
      where coalesce(ends_at, starts_at) >= now() and not (event ? 'topic')`,
    setEvent: (external_id, event) => sql`
      update collected_events set event = ${sql.json(event)}, updated_at = now() where external_id = ${external_id}`,
    end: () => sql.end(),
  };
}
