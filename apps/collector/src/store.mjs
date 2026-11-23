// Хранилище сборщика в Postgres. Таблицы описаны в apps/api/src/db/schema.ts и создаются миграциями API; здесь — только
// запросы. Типы их не проверяют, поэтому каждый запрос прогоняет на настоящей базе apps/api/src/collector-store.test.ts:
// переименовал колонку — упадёт тест, а не сборщик в проде. Новый запрос добавляй и туда.
import postgres from 'postgres';

/**
 * Организатор уже входил в сервис — привязать профиль к его пользователю. Пользователя ищем по способу входа telegram:
 * users.id — не Telegram id (ADR-0008).
 */
const linkUser = (tx, telegramId) => tx`
  update hosts set user_id = i.user_id from user_identities i
  where i.provider = 'telegram' and i.subject = ${String(telegramId)} and hosts.telegram_id = ${telegramId}`;

export function createStore(url) {
  const sql = postgres(url, { onnotice: () => {} });
  return {
    /**
     * Источники из CHANNELS (LEAD_CHATS, JOB_CHATS — с `kind` leads, jobs): добавляем те, которых ещё нет, в первый город.
     * Выключенный, перенесённый в другой город или сменивший вид в админке так и остаётся.
     */
    addSources: async (channels, kind = 'announcements') => {
      if (!channels.length) return [];
      await sql`insert into sources ${sql(channels.map((channel) => ({ channel, kind })))} on conflict do nothing`;
      // Уже были с другим видом: сборщик их не переделывает (вид правит команда), но о расхождении скажет.
      return sql`select channel, kind from sources where lower(channel) in ${sql(channels.map((c) => c.toLowerCase()))} and kind <> ${kind}`;
    },
    /** Что уже известно (find-sources): username источника → «есть» или «выключен», username организатора → «организатор». */
    knownChannels: async () => {
      const known = new Map();
      for (const s of await sql`select channel, enabled from sources`) known.set(s.channel.toLowerCase(), s.enabled ? 'есть' : 'выключен');
      for (const h of await sql`select lower(username) u from hosts where username is not null`) if (!known.has(h.u)) known.set(h.u, 'организатор');
      return known;
    },
    /**
     * Поиск источников (source_searches): городу без поиска за `days` дней — новому или давно не искавшему — ставим
     * поиск в очередь. Ищем по названию и другим написаниям города на этот момент.
     */
    queueSourceSearches: (days) => sql`
      insert into source_searches (city_id, names)
      select c.id, jsonb_build_array(c.name) || c.aliases from cities c
      where not exists (select 1 from source_searches s where s.city_id = c.id and s.created_at > now() - make_interval(days => ${days}))`,
    /** Взять следующий поиск из очереди; null — очередь пуста. */
    takeSourceSearch: async () => (await sql`
      update source_searches set status = 'running'
      where id = (select id from source_searches where status = 'queued' order by created_at limit 1)
      returning id, city_id, names`)[0] ?? null,
    /** Поиск, оборванный перезапуском сборщика, — снова в очередь. */
    requeueSourceSearches: () => sql`update source_searches set status = 'queued' where status = 'running'`,
    finishSourceSearch: (id, { results = [], error = null }) => sql`
      update source_searches set status = ${error ? 'failed' : 'done'}, error = ${error}, results = ${sql.json(results)}, finished_at = now()
      where id = ${id}`,
    /** Найденные поиском каналы — в источники города; уже известный канал не трогаем. Возвращает добавленные. */
    addFoundSources: async (city_id, channels) => channels.length ? (await sql`
      insert into sources ${sql(channels.map((channel) => ({ channel, city_id, kind: 'announcements' })))}
      on conflict do nothing returning channel`).map((r) => r.channel) : [],
    /** Каналы и группы, которые аккаунт `account` уже нашёл по username (tg_peers): [{ username, peer_id, access_hash }]. */
    peers: (account) => sql`select username, peer_id, access_hash from tg_peers where account = ${account}`,
    savePeers: (account, peers) => peers.length ? sql`
      insert into tg_peers ${sql(peers.map((p) => ({ account, ...p })))}
      on conflict (account, username) do update set peer_id = excluded.peer_id, access_hash = excluded.access_hash, updated_at = now()` : [],
    /** Источник, которого больше нет в Telegram, — выключить с причиной; команда видит её в «Источниках» и может включить. */
    disableSource: (channel, reason) => sql`
      update sources set enabled = false, disabled_reason = ${reason} where lower(channel) = lower(${channel}) and enabled`,
    /** Каналы организаторов, которых ещё нет в источниках, — не больше `limit` за раз; возвращает добавленные. */
    adoptHostChannels: async (limit) => (await sql`
      insert into sources (channel, host_id, city_id)
      select channel, id, city_id from hosts h
      where channel is not null and not exists (select 1 from sources s where lower(s.channel) = lower(h.channel))
      order by created_at limit ${limit}
      on conflict do nothing
      returning channel`).map((r) => r.channel),
    /**
     * Включённые источники; у канала организатора — его username: контакт для анонсов без контакта.
     * Город источника (id, название, часовой пояс) получают события из него; в этом поясе ИИ читает время анонса.
     */
    /** Включённые темы в порядке фильтров — как `GET /topics`: ими сборщик заменяет реестр ядра каждый проход. */
    topics: () => sql`
      select name, slug, emoji, color, what, why, first, not_for from topics where enabled order by position, created_at`,
    /**
     * Кандидаты в темы: метки событий без темы («другое») за 90 дней, которые встретились не меньше чем в `minEvents`
     * событиях у `minHosts` разных организаторов и ещё не тема и не метка темы (в том числе выключенной).
     */
    topicCandidates: (minEvents, minHosts) => sql`
      select lower(t) as tag, count(*)::int as events_count, count(distinct coalesce(e.telegram_username, e.channel))::int as hosts_count,
        (array_agg(e.event->>'title' order by e.created_at desc))[1:5] as examples
      from collected_events e, jsonb_array_elements_text(e.event->'tags') t
      where e.event->>'topic' = 'другое' and e.created_at > now() - interval '90 days'
        and lower(t) not in (select name from topics union all select jsonb_array_elements_text(tags) from topics)
      group by 1 having count(*) >= ${minEvents} and count(distinct coalesce(e.telegram_username, e.channel)) >= ${minHosts}
      order by 2 desc, 1 limit 10`,
    /**
     * Новая тема от сборщика (origin = collector): события без темы с её метками переходят в неё. false — имя или slug
     * заняты. Иконку нарисует иллюстратор: очередь иконок в API (apps/api/src/topics.ts).
     */
    addTopic: ({ name, slug, emoji, color, what, why, first, not_for, tags }) => sql.begin(async (tx) => {
      const added = await tx`
        insert into topics (name, slug, emoji, color, what, why, first, not_for, tags, origin, position)
        values (${name}, ${slug}, ${emoji}, ${color.toLowerCase()}, ${what}, ${why}, ${first}, ${not_for}, ${tx.json(tags)}, 'collector', (select coalesce(max(position), 0) + 1 from topics))
        on conflict do nothing returning name`;
      if (!added.length) return false;
      if (tags.length) {
        await tx`
          update collected_events set event = jsonb_set(event, '{topic}', to_jsonb(${name}::text)), updated_at = now()
          where event->>'topic' = 'другое' and exists (select 1 from jsonb_array_elements_text(event->'tags') t where lower(t) in ${tx(tags)})`;
      }
      return true;
    }),
    /** Города, первый — старейший: разовые скрипты (find-sources, scout, backfill-jobs) берут из них название города. */
    cities: () => sql`select id, name, aliases from cities order by created_at, id`, // порядок — как у listCities в API
    sources: () => sql`
      select s.channel, h.username as host_username, s.city_id, c.name as city, c.timezone
      from sources s join cities c on c.id = s.city_id left join hosts h on h.id = s.host_id
      where s.enabled and s.kind = 'announcements' order by s.created_at, s.channel`,
    /**
     * Включённые чаты, где ищем не анонсы: `leads` — вопросы, мастера и вакансии (бывший LEAD_CHATS), иначе только
     * вакансии (JOB_CHATS). Мастера и вакансии получают город чата (`city_id`, `city` — его название для ИИ).
     */
    chats: () => sql`
      select s.channel as chat, s.kind = 'leads' as leads, s.city_id, c.name as city
      from sources s join cities c on c.id = s.city_id
      where s.enabled and s.kind in ('leads', 'jobs') order by s.created_at`,
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
      select external_id, city_id, event, status, exists(select 1 from photos p where p.collected_external_id = e.external_id) as has_cover
      from collected_events e where coalesce(ends_at, starts_at) >= now()`,
    /**
     * Доверенные источники: за 90 дней команда одобрила из них не меньше `min` событий и ни одного не отклонила.
     * Их новые события сборщик пишет сразу одобренными. Одно отклонение — и источник снова идёт через модерацию.
     */
    trustedChannels: async (min) => (await sql`
      select channel from collected_events where created_at > now() - interval '90 days'
      group by channel
      having count(*) filter (where status in ('approved', 'published')) >= ${min} and count(*) filter (where status = 'rejected') = 0`)
      .map((r) => r.channel),
    /** Новое событие или дополнение уже известного. Публикация и решение модерации остаются от первого анонса. */
    upsert: ({ external_id, channel, city_id, announcement, event, signup_url, status = 'pending' }) => sql`
      insert into collected_events ${sql({
        external_id, channel, city_id, signup_url, status,
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
    unprofiled: () => sql`
      select telegram_username as username, min(city_id) as city_id from collected_events
      where telegram_username ~ '^\\w{4,32}$' and coalesce(ends_at, starts_at) >= now()
        and status in ('approved', 'published')
        and telegram_username not in (select username from hosts)
      group by telegram_username`,
    /** Организаторы, которых команда добавила по username в админке: заготовки без telegram_id, ждут проверки. */
    requestedHosts: async () => (await sql`
      select username from hosts where telegram_id is null and status = 'pending' order by created_at`).map((r) => r.username),
    /**
     * Под username из заготовки нет ни человека, ни канала: отклоняем её с пояснением — команда увидит это в карточке,
     * а сборщик не будет искать снова. Вернуть в очередь — снова поставить статус pending.
     */
    rejectRequestedHost: (username) => sql`
      update hosts set status = 'rejected', summary = 'Сборщик не нашёл в Telegram ни человека, ни канала с таким username.'
      where username = ${username} and telegram_id is null`,
    /**
     * Профиль организатора. Сменил username — строка та же. Уже входил в Ясвами — профиль сразу привязан к нему.
     * Заготовку команды (username без telegram_id) заполняем на месте: её id уже может стоять у источников. Если этот
     * человек уже есть под другим username, источники заготовки переходят к его строке, а заготовка удаляется.
     */
    saveHost: (host) => sql.begin(async (tx) => {
      const stub = () => tx`username = ${host.username} and telegram_id is null`;
      await tx`update hosts set ${tx(host)} where ${stub()} and not exists (select 1 from hosts where telegram_id = ${host.telegram_id})`;
      await tx`insert into hosts ${tx(host)} on conflict (telegram_id) do update set username = excluded.username`;
      await tx`update sources set host_id = (select id from hosts where telegram_id = ${host.telegram_id}) where host_id in (select id from hosts where ${stub()})`;
      await tx`delete from hosts where ${stub()}`;
      await linkUser(tx, host.telegram_id);
      await tx`update hosts set profiled_at = now() where telegram_id = ${host.telegram_id}`;
    }),
    /**
     * Профили, которые сборщик не смотрел дольше `days` дней (или ни разу: мастера из чатов, offers.mjs), кроме
     * отклонённых. `has_summary` — сводку уже писали: повторно в ИИ не отправляем.
     */
    staleProfiles: (days, limit) => sql`
      select username, telegram_id, summary is not null as has_summary from hosts
      where telegram_id is not null and status <> 'rejected'
        and (profiled_at is null or profiled_at < now() - make_interval(days => ${days}))
      order by profiled_at nulls first limit ${limit}`,
    /**
     * Свежее из Telegram: «о себе» и канал. Имя и сводку правит команда, поэтому их не трогаем — сводку пишем, только
     * если её нет (стереть в карточке — сборщик напишет заново). Канал не стираем: его могла указать команда.
     */
    refreshHost: ({ telegram_id, bio, channel, summary }) => sql`
      update hosts set bio = ${bio}, channel = coalesce(${channel}, channel), summary = coalesce(summary, ${summary}), profiled_at = now()
      where telegram_id = ${telegram_id}`,
    /** Профиль посмотрели, но обновить нечем (username теперь чужой или пропал): не спрашиваем снова до следующего срока. */
    profileChecked: (telegram_id) => sql`update hosts set profiled_at = now() where telegram_id = ${telegram_id}`,
    /** Уже знаем, что этот человек ведёт (offers.mjs): объявление повторно в ИИ не отправляем. `who` — Telegram id или username. */
    hasPractices: async (who) => (await sql`
      select 1 from practices p join hosts h on h.id = p.host_id
      where ${typeof who === 'number' ? sql`h.telegram_id = ${who}` : sql`h.username = ${who}`} limit 1`).length > 0,
    /**
     * Мастер по своему самопредставлению: сводку из профиля (если уже есть) не трогаем. Practice добавляем, только пока
     * у него нет ни одной: дальше их правит и одобряет команда. Каждая новая ждёт её решения (status по умолчанию — pending).
     */
    saveOffer: ({ practices, ...host }) => sql.begin(async (tx) => {
      const [{ id }] = await tx`
        insert into hosts ${tx(host)}
        on conflict (telegram_id) do update set username = excluded.username, offer_url = excluded.offer_url, summary = coalesce(hosts.summary, excluded.summary)
        returning id`;
      if (practices.length && !(await tx`select 1 from practices where host_id = ${id} limit 1`).length) {
        await tx`insert into practices ${tx(practices.map(({ title, topic, description, price }, position) => ({ host_id: id, title, topic, description, price, position })))}`;
      }
      await linkUser(tx, host.telegram_id);
    }),
    /**
     * Организаторы с каналом, у которых фото сообщества не смотрели дольше `days` дней, кроме отклонённых. Не только
     * с предстоящими событиями: добавленному командой фото нужны и до первого события.
     */
    stalePhotos: (days, limit) => sql`
      select id, channel from hosts
      where channel is not null and status <> 'rejected'
        and (photos_checked_at is null or photos_checked_at < now() - make_interval(days => ${days}))
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
      select external_id, announcement, event, c.name as city, c.timezone from collected_events e join cities c on c.id = e.city_id
      where coalesce(ends_at, starts_at) >= now() and not (event ? 'topic')`,
    setEvent: (external_id, event) => sql`
      update collected_events set event = ${sql.json(event)}, updated_at = now() where external_id = ${external_id}`,
    /** Предстоящие события, чью публикацию ещё не разбирали с фото и видео (refresh.mjs). */
    withoutMedia: () => sql`
      select external_id, announcement, event, c.name as city, c.timezone from collected_events e join cities c on c.id = e.city_id
      where coalesce(ends_at, starts_at) >= now() and status <> 'rejected' and not (announcement ? 'media')
      order by starts_at`,
    refreshed: (external_id, event, media) => sql`
      update collected_events set event = ${sql.json(event)}, announcement = announcement || ${sql.json({ media })}, updated_at = now()
      where external_id = ${external_id}`,
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
    /** Забрать сообщение из очереди на отправку; false — его уже забрали или отменили. */
    claim: async (id) => (await sql`update messages set status = 'sending' where id = ${id} and status = 'queued' returning id`).length > 0,
    failStuck: () => sql`update messages set status = 'failed' where status = 'sending'`,
    messageStatus: (id, status) => sql`update messages set status = ${status} where id = ${id}`,
    /** Включённые Запросы организаторов: что ищут, ключевые слова (null — ещё не выведены) и кто организатор в Telegram. */
    activeSearches: () => sql`
      select s.id, s.query, s.keywords, h.telegram_id::float8 as host_telegram_id
      from host_searches s join hosts h on h.id = s.host_id
      where s.status = 'active' and h.user_id is not null`,
    /** Ключевые слова Запроса — только если текст не сменился, пока ИИ думал. */
    saveSearchKeywords: (id, query, keywords) => sql`update host_searches set keywords = ${keywords} where id = ${id} and query = ${query}`,
    /** Находка по Запросу; то же сообщение второй раз не пишется. */
    saveSearchMatch: ({ search_id, chat, message_id, url, author, text, sent_at }) => sql`
      insert into host_search_matches ${sql({ search_id, chat, message_id, url, author_id: author.id, author_name: author.name, author_username: author.username, text, sent_at })}
      on conflict do nothing`,
    /** Повтор объявления (jobs.mjs): сдвигает posted_at, решение команды (status) не трогает; false — такой вакансии нет. */
    touchJob: async (city_id, text_hash, posted_at) => (await sql`
      update jobs set posted_at = greatest(posted_at, ${posted_at}) where city_id = ${city_id} and text_hash = ${text_hash}
      returning id`).length > 0,
    /** Новая вакансия ждёт решения команды (status по умолчанию — pending). Тот же текст в том же городе — только сдвиг posted_at. */
    saveJob: (job) => sql`
      insert into jobs ${sql({ ...job, announcement: sql.json(job.announcement) })}
      on conflict (city_id, text_hash) do update set posted_at = greatest(jobs.posted_at, excluded.posted_at)`,
    end: () => sql.end(),
  };
}
