// Хранилище сборщика в Postgres. Таблицы описаны в apps/api/src/db/schema.ts (collected_events, sources,
// collector_cursors) и создаются миграциями API; здесь — только запросы.
import postgres from 'postgres';

export function createStore(url) {
  const sql = postgres(url, { onnotice: () => {} });
  return {
    /** Источники из CHANNELS: добавляем те, которых ещё нет; выключенный в админке так и остаётся выключенным. */
    addSources: (channels) => channels.length ? sql`insert into sources ${sql(channels.map((channel) => ({ channel })))} on conflict do nothing` : [],
    /** Каналы организаторов, которых ещё нет в источниках, — не больше `limit` за раз; возвращает добавленные. */
    adoptHostChannels: async (limit) => (await sql`
      insert into sources (channel, host_id)
      select channel, id from hosts h
      where channel is not null and not exists (select 1 from sources s where lower(s.channel) = lower(h.channel))
      order by created_at limit ${limit}
      on conflict do nothing
      returning channel`).map((r) => r.channel),
    /** Включённые источники; у канала организатора — его username: контакт для анонсов без контакта. */
    sources: () => sql`
      select s.channel, h.username as host_username from sources s left join hosts h on h.id = s.host_id
      where s.enabled order by s.created_at`,
    /** Номер последней разобранной публикации по каждому источнику. */
    async cursors() {
      const rows = await sql`select channel, last_number from collector_cursors`;
      return Object.fromEntries(rows.map((r) => [r.channel, r.last_number]));
    },
    saveCursor: (channel, number) => sql`
      insert into collector_cursors (channel, last_number) values (${channel}, ${number})
      on conflict (channel) do update set last_number = excluded.last_number`,
    /** Предстоящие события — с ними склеиваются повторные анонсы. */
    upcoming: () => sql`
      select external_id, event, status, exists(select 1 from photos p where p.collected_external_id = e.external_id) as has_cover
      from collected_events e where coalesce(ends_at, starts_at) >= now()`,
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
    /**
     * Контакты предстоящих событий, по которым профиль ещё не собран. Только одобренные командой события: профиль даёт
     * каналу организатора место в источниках, а контакт в непроверенном анонсе мог подставить кто угодно.
     */
    unprofiled: async () => (await sql`
      select distinct telegram_username from collected_events
      where telegram_username ~ '^\\w{4,32}$' and coalesce(ends_at, starts_at) >= now()
        and status in ('approved', 'published')
        and telegram_username not in (select username from hosts)`).map((r) => r.telegram_username),
    /** Профиль организатора. Сменил username — строка та же. Уже входил в Ясвами — профиль сразу привязан к нему. */
    saveHost: (host) => sql`
      insert into hosts ${sql(host)} on conflict (telegram_id) do update set username = excluded.username`
      // Пока все пользователи — из Telegram, users.id и есть Telegram id.
      .then(() => sql`update hosts set user_id = u.id from users u where u.id = hosts.telegram_id and hosts.telegram_id = ${host.telegram_id}`),
    /** Организаторы предстоящих событий с каналом, у которых фото сообщества не смотрели дольше `days` дней. */
    stalePhotos: (days, limit) => sql`
      select id, channel from hosts
      where channel is not null and (photos_checked_at is null or photos_checked_at < now() - make_interval(days => ${days}))
        and username in (select telegram_username from collected_events where coalesce(ends_at, starts_at) >= now())
      order by photos_checked_at nulls first limit ${limit}`,
    photoSources: async (hostId) => (await sql`select source from photos where host_id = ${hostId}`).map((r) => r.source),
    /** Фото сообщества: убираем те, которых в канале уже нет среди последних (`sources`), добавляем новые. */
    savePhotos: (hostId, sources, added) => sql.begin(async (tx) => {
      await tx`delete from photos where host_id = ${hostId} and source not in (select unnest(${sources}::text[]))`;
      // clock_timestamp: у строк одной транзакции now() одинаковый, а по created_at API показывает новые сверху.
      for (const { source, data } of added) {
        await tx`insert into photos (host_id, source, data, created_at) values (${hostId}, ${source}, ${data}, clock_timestamp())
          on conflict do nothing`;
      }
    }),
    photosChecked: (hostId) => sql`update hosts set photos_checked_at = now() where id = ${hostId}`,
    /** Предстоящие события без полей «что это мне даст»: собраны до их появления. */
    withoutTopic: () => sql`
      select external_id, announcement, event from collected_events
      where coalesce(ends_at, starts_at) >= now() and not (event ? 'topic')`,
    setEvent: (external_id, event) => sql`
      update collected_events set event = ${sql.json(event)}, updated_at = now() where external_id = ${external_id}`,
    /** Отклик на публикацию-источник — всем событиям из неё (`prefix` — telegram:<канал>/<публикация>#). */
    setStats: (prefix, { views, reactions }) => sql`
      update collected_events set views = ${views}, reactions = ${reactions} where starts_with(external_id, ${prefix})`,
    /** Фото анонса как обложка события. Обложка уже есть (нарисовал иллюстратор) — не трогаем. */
    saveCover: (external_id, source, data) => sql`
      insert into photos (collected_external_id, source, data) values (${external_id}, ${source}, ${data})
      on conflict (collected_external_id) do nothing`,
    /** Аккаунты Telegram, с которых мы пишем людям (sender.mjs), вместе с сессией и шагом входа. */
    accounts: () => sql`select id, label, phone, status, session, login from tg_accounts order by created_at`,
    accountUpdate: (id, fields) => sql`update tg_accounts set ${sql({ ...fields, ...('login' in fields ? { login: fields.login && sql.json(fields.login) } : {}) })} where id = ${id}`,
    /** Сообщения, которые API поставил в очередь на отправку с аккаунтов, в порядке появления. */
    queued: () => sql`
      select m.id, m.text, m.meta, c.account_id, c.peer_id, c.peer_username
      from messages m join conversations c on c.id = m.conversation_id
      where m.status = 'queued' and c.channel = 'account' and c.account_id is not null
      order by m.created_at limit 20`,
    messageStatus: (id, status) => sql`update messages set status = ${status} where id = ${id}`,
    end: () => sql.end(),
  };
}
