// Аккаунты Telegram, с которых мы пишем людям (docs/agents-inbox.md). Отдельно от читающего юзербота: блокировка
// пишущего аккаунта не должна останавливать сбор событий.
// Сборщик здесь — только транспорт: входит в аккаунт по шагам из админки, пересылает личные сообщения в API
// и отправляет то, что API положил в очередь. Что отвечать и кому — решает не он.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import telegram from 'telegram';
import { NewMessage, Raw } from 'telegram/events/index.js';
import { COLD_PAUSE_DAYS, inboxMediaKey, mediaExt } from '@yaswami/core';
import { chatAddress } from './address.mjs';
import { pickThumb } from './host.mjs';
import { connect } from './mtproto.mjs';

const NO_TEXT = '[сообщение без текста]';
// Telegram повторяет «печатает» каждые ~5 с; API держит отметку 6 с, поэтому чаще раза в 4 с сообщать незачем.
const TYPING_EVERY_MS = 4000;
const SMS_HINT = 'Telegram отправил код по СМС, а не в приложение: на этом номере нет входа в Telegram. Если СМС не пришла — войдите в Telegram с телефона и добавьте аккаунт заново';

/** Сессия аккаунта — полный доступ к нему: в базе лежит только зашифрованной (AES-256-GCM, ключ — у сборщика). */
export function seal(key, text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
}
export function unseal(key, sealed) {
  const [iv, tag, body] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

const code = (e) => e?.errorMessage ?? e?.message ?? String(e);
// Сессии больше нет: помочь может только новый вход. Всё остальное (сеть, FLOOD_WAIT) проходит само.
const SESSION_DEAD = /AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED|PHONE_NUMBER_BANNED/;
const RECONNECT_MS = 60_000;
// Вложение в переписке тяжелее — не качаем: в админке будет «не сохранили», расшифровки не будет.
const MEDIA_MAX_BYTES = 50_000_000;
const PHOTO_SIDE = 1280;
// Помним столько последних своих отправленных сообщений на аккаунт: больше для отсева эха не нужно, а память не растёт.
const SENT_IDS_MAX = 1000;
// Каждое входящее — запись в бакет и вызов API, а там расшифровка, уведомление команде и черновик ИИ.
// Поток сообщений от одного человека режем здесь, до всех этих трат: сверх лимита сообщение отбрасывается целиком.
const MESSAGES_PER_MINUTE = 10;
const ATTACHMENTS_PER_DAY = 20;

/**
 * Лимит в фиксированном окне по ключу: `hit(key)` → 'ok', 'over' (первое превышение в окне — пишем в лог) или 'quiet'.
 * Ключей не больше `maxKeys`: при переполнении сначала выкидываем истёкшие, потом самые старые — не всё разом.
 */
export function createLimiter({ limit, windowMs, maxKeys = 10_000 }) {
  const hits = new Map(); // ключ → { start, count, warned }
  return function hit(key, now = Date.now()) {
    let h = hits.get(key);
    if (!h || now - h.start >= windowMs) {
      hits.delete(key);
      if (hits.size >= maxKeys) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
      if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
      h = { start: now, count: 0, warned: false };
      hits.set(key, h);
    }
    h.count += 1;
    if (h.count <= limit) return 'ok';
    if (h.warned) return 'quiet';
    h.warned = true;
    return 'over';
  };
}

/**
 * Вложение сообщения MTProto: что это, без скачивания. null — вложения нет или оно не наше (стикер, ссылка, опрос).
 * Голосовое и кружок Telegram отличает атрибутами документа, а не типом содержимого.
 */
export function attachmentOf(msg) {
  const media = msg.media;
  if (media?.className === 'MessageMediaPhoto') {
    const thumb = pickThumb(media.photo?.sizes, PHOTO_SIDE);
    return thumb ? { type: 'photo', mime_type: 'image/jpeg', duration: null, file_name: null, size: 0, thumb } : null;
  }
  const doc = media?.className === 'MessageMediaDocument' ? media.document : null;
  if (!doc) return null;
  const attr = (name) => doc.attributes?.find((a) => a.className === name);
  if (attr('DocumentAttributeSticker')) return null;
  const audio = attr('DocumentAttributeAudio');
  const video = attr('DocumentAttributeVideo');
  const type = audio ? (audio.voice ? 'voice' : 'audio') : video ? (video.roundMessage ? 'video_note' : 'video') : 'document';
  return { type, mime_type: doc.mimeType ?? null, duration: (audio ?? video)?.duration ?? null, file_name: attr('DocumentAttributeFilename')?.fileName ?? null, size: Number(doc.size ?? 0) };
}

/**
 * `store` — запросы к базе (store.mjs), `report` — сообщить API о личном сообщении или ответе нам в чате, `reportTyping` — что собеседник
 * набирает сообщение, `connectClient` — клиент MTProto (тесты подставляют свой). `tick()` делает один проход: шаги входа, подключение аккаунтов, отправка очереди.
 */
export function createSender({ store, apiId, apiHash, key, report, reportTyping = async () => {}, bucket = null, connectClient = connect, log = console.log }) {
  const clients = new Map(); // id аккаунта → подключённый клиент
  const logins = new Map(); // id аккаунта → { client, phoneCodeHash }: вход между шагами живёт только в памяти
  const retryAt = new Map(); // id аккаунта → когда снова пробовать подключиться после сбоя
  let started = false;
  const sentIds = new Map(); // id аккаунта → последние номера сообщений, отправленных нами: о них в API не сообщаем
  const messageLimit = createLimiter({ limit: MESSAGES_PER_MINUTE, windowMs: 60_000 });
  const attachmentLimit = createLimiter({ limit: ATTACHMENTS_PER_DAY, windowMs: 86_400_000 });

  function rememberSent(accountId, id) {
    const ids = sentIds.get(accountId);
    if (!ids) return;
    ids.add(id);
    // Set помнит порядок добавления: первый — самый старый.
    if (ids.size > SENT_IDS_MAX) ids.delete(ids.values().next().value);
  }

  /** Не слишком ли часто пишет этот человек этому аккаунту. Сверх лимита — отбрасываем, в лог раз за окно. */
  function withinLimits(account, peerId, withAttachment) {
    const key = `${account.id}:${peerId}`;
    const checks = [[messageLimit, 'сообщений в минуту']];
    if (withAttachment) checks.push([attachmentLimit, 'вложений в сутки']);
    for (const [limit, what] of checks) {
      const verdict = limit(key);
      if (verdict === 'ok') continue;
      if (verdict === 'over') log(`аккаунт ${account.label}: от ${peerId} слишком много ${what} — отбрасываем до конца окна`);
      return false;
    }
    return true;
  }

  /**
   * Вложение — в бакет, в папку собеседника (inboxMediaKey); расшифровывает речь API. Без бакета или не скачалось —
   * вложение всё равно передаём, без адреса: в админке видно, что человек прислал голосовое.
   */
  async function saveAttachment(client, msg, peerId, info) {
    const { size, thumb, ...media } = info;
    if (!bucket || size > MEDIA_MAX_BYTES) return { ...media, url: null };
    try {
      const data = await client.downloadMedia(msg, thumb ? { thumb } : {});
      if (!Buffer.isBuffer(data)) return { ...media, url: null };
      const key = inboxMediaKey('account', peerId, randomUUID(), mediaExt(media.mime_type, media.type, media.file_name));
      return { ...media, url: await bucket.put(key, data, media.mime_type ?? 'application/octet-stream') };
    } catch (e) {
      log(`вложение от ${peerId} не сохранено: ${code(e)}`);
      return { ...media, url: null };
    }
  }

  function listen(account, client) {
    client.addEventHandler(async (event) => {
      try {
        const msg = event.message;
        if (sentIds.get(account.id)?.has(msg.id)) return;
        // В чатах нам интересно одно: человек ответил на наше сообщение (Telegram помечает такой ответ `mentioned`).
        // Это продолжение разговора, начатого ответом на вопрос «куда сходить»; чей это собеседник, решает API.
        const inChat = !event.isPrivate;
        if (inChat && (msg.out || !msg.mentioned || !msg.replyTo)) return;
        // `mentioned` стоит и на ответе чужому сообщению с @упоминанием нашего аккаунта: проверяем, что ответили именно нам.
        if (inChat && !(await msg.getReplyMessage())?.out) return;
        const chat = await msg.getChat();
        const peer = inChat ? await msg.getSender() : chat;
        if (!chat || !peer || peer.bot || peer.className !== 'User') return;
        const info = attachmentOf(msg);
        if (!msg.out && !withinLimits(account, Number(peer.id), Boolean(info))) return;
        const media = info ? [await saveAttachment(client, msg, Number(peer.id), info)] : [];
        await report({
          account_id: account.id,
          peer: { id: Number(peer.id), name: [peer.firstName, peer.lastName].filter(Boolean).join(' ') || String(peer.id), username: peer.username ?? null },
          direction: msg.out ? 'out' : 'in',
          // Голосовое без подписи — без текста: что в нём, скажет расшифровка.
          text: msg.message || (media.length ? '' : NO_TEXT),
          ...(media.length ? { media } : {}),
          // Адрес чата — как в lead.mjs: username или полный id; по нему же уйдёт наш ответ.
          ...(inChat ? { reply_to: { chat: chatAddress(chat), message_id: msg.id } } : {}),
        });
      } catch (e) {
        log(`аккаунт ${account.label}: сообщение не передано в API: ${code(e)}`);
      }
    }, new NewMessage({}));
    // Собеседник набирает сообщение — админка покажет «печатает». Боту Telegram такого не присылает, аккаунту — да.
    const typingSent = new Map(); // id собеседника → когда сообщили в API
    client.addEventHandler(async (update) => {
      if (update.action?.className === 'SendMessageCancelAction') return;
      const peer = Number(update.userId);
      if (Date.now() - (typingSent.get(peer) ?? 0) < TYPING_EVERY_MS) return;
      if (typingSent.size > 10_000) typingSent.clear();
      typingSent.set(peer, Date.now());
      await reportTyping({ account_id: account.id, peer_id: peer }).catch((e) => log(`аккаунт ${account.label}: «печатает» не передано в API: ${code(e)}`));
    }, new Raw({ types: [telegram.Api.UpdateUserTyping] }));
    clients.set(account.id, client);
    sentIds.set(account.id, new Set());
  }

  async function activate(account, client) {
    await store.accountUpdate(account.id, { status: 'active', session: seal(key, client.session.save()), login: null, last_error: null });
    logins.delete(account.id);
    listen(account, client);
    log(`аккаунт ${account.label}: вход выполнен`);
  }

  /** Один шаг входа. Код и пароль берём из строки аккаунта и сразу стираем. */
  async function login(account) {
    // API шифрует код и пароль нашим ключом, если он у него есть (ACCOUNTS_KEY); иначе они лежат открыто.
    const secret = account.login?.sealed ? unseal(key, account.login.sealed) : account.login?.secret;
    try {
      if (account.status === 'login_requested') {
        const client = connectClient({ apiId, apiHash });
        await client.connect();
        const { phoneCodeHash, isCodeViaApp } = await client.sendCode({ apiId: Number(apiId), apiHash }, account.phone);
        logins.set(account.id, { client, phoneCodeHash });
        // Куда ушёл код, решает Telegram: есть вход на другом устройстве — в приложение (чат «Telegram»), нет — по СМС,
        // а СМС стороннему клиенту он часто не доставляет. Без этой подсказки в админке ждут СМС, которой не будет.
        log(`аккаунт ${account.label}: код отправлен ${isCodeViaApp ? 'в приложение Telegram' : 'не в приложение (СМС или звонок)'}`);
        return await store.accountUpdate(account.id, { status: 'login_code', last_error: isCodeViaApp ? null : SMS_HINT });
      }
      if (!secret) return; // ждём, пока в админке введут код или пароль
      const pending = logins.get(account.id);
      // Код привязан к соединению, которое его запросило: после перезапуска сборщика вход начинается заново.
      if (!pending) return await store.accountUpdate(account.id, { status: 'login_requested', login: null, last_error: 'Вход прервался, запросили новый код' });
      if (account.status === 'login_code') {
        await pending.client.invoke(new telegram.Api.auth.SignIn({ phoneNumber: account.phone, phoneCodeHash: pending.phoneCodeHash, phoneCode: secret }));
      } else {
        await pending.client.signInWithPassword({ apiId: Number(apiId), apiHash }, { password: async () => secret, onError: (e) => { throw e; } });
      }
      await activate(account, pending.client);
    } catch (e) {
      const reason = code(e);
      if (reason === 'SESSION_PASSWORD_NEEDED') return await store.accountUpdate(account.id, { status: 'login_password', login: null, last_error: null });
      if (reason === 'PHONE_CODE_INVALID') return await store.accountUpdate(account.id, { login: null, last_error: 'Неверный код' });
      if (reason === 'PASSWORD_HASH_INVALID') return await store.accountUpdate(account.id, { login: null, last_error: 'Неверный пароль' });
      logins.delete(account.id);
      await store.accountUpdate(account.id, { status: 'error', login: null, last_error: reason });
      log(`аккаунт ${account.label}: вход не удался: ${reason}`);
    }
  }

  async function connectAccount(account) {
    if (Date.now() < (retryAt.get(account.id) ?? 0)) return;
    let client;
    try {
      client = connectClient({ apiId, apiHash, session: unseal(key, account.session) });
      await client.connect();
      // Список диалогов даёт клиенту адреса собеседников: без него после перезапуска некому ответить по id.
      await client.getDialogs({ limit: 100 });
      listen(account, client);
      log(`аккаунт ${account.label}: на связи`);
    } catch (e) {
      await client?.disconnect().catch(() => {});
      // `error` — только когда сессии больше нет: из него один путь — новый вход с кодом. Сбой сети или FLOOD_WAIT
      // аккаунт не портит: пробуем снова через минуту.
      if (SESSION_DEAD.test(code(e))) await store.accountUpdate(account.id, { status: 'error', last_error: code(e) });
      else retryAt.set(account.id, Date.now() + RECONNECT_MS);
      log(`аккаунт ${account.label}: не подключился: ${code(e)}`);
    }
  }

  async function send(row) {
    const client = clients.get(row.account_id);
    if (!client) return; // аккаунт ещё не на связи — сообщение подождёт в очереди
    // Забираем сообщение до отправки: упадём между отправкой и отметкой «sent» — оно не уйдёт человеку второй раз.
    if (!(await store.claim(row.id))) return;
    try {
      // Ответ на вопрос в чате уходит реплаем в этот чат (аккаунт должен в нём состоять), остальное — в личку.
      const reply = row.meta?.reply_to;
      const sent = reply
        ? await client.sendMessage(/^-?\d+$/.test(reply.chat) ? Number(reply.chat) : reply.chat, { message: row.text, replyTo: reply.message_id })
        // По id — без запроса к Telegram; по username — запасной путь: поиск по нему флудоопасен.
        : await client.sendMessage(Number(row.peer_id), { message: row.text })
          .catch((e) => (row.peer_username ? client.sendMessage(row.peer_username, { message: row.text }) : Promise.reject(e)));
      rememberSent(row.account_id, sent.id);
      await store.messageStatus(row.id, 'sent');
    } catch (e) {
      // PEER_FLOOD — Telegram ограничил аккаунт за сообщения незнакомым. Сообщение не теряем: возвращаем в черновики,
      // а первые сообщения с аккаунта ставим на паузу — новая попытка только продлит ограничение (COLD_PAUSE_DAYS).
      if (code(e) === 'PEER_FLOOD') {
        const until = new Date(Date.now() + COLD_PAUSE_DAYS * 86_400_000);
        await store.messageStatus(row.id, 'draft');
        await store.accountUpdate(row.account_id, { cold_paused_until: until, last_error: `Telegram ограничил первые сообщения (PEER_FLOOD): пауза до ${until.toISOString().slice(0, 10)}` });
        log(`очередь: сообщение ${row.id} вернули в черновики — аккаунт ограничен Telegram (PEER_FLOOD)`);
        return;
      }
      await store.messageStatus(row.id, 'failed');
      await store.accountUpdate(row.account_id, { last_error: `Не отправлено: ${code(e)}` });
      log(`очередь: сообщение ${row.id} не отправлено: ${code(e)}`);
    }
  }

  return {
    async tick() {
      // Сообщения, на отправке которых оборвался прошлый запуск: ушли они или нет, неизвестно — решит человек.
      if (!started) await store.failStuck();
      started = true;
      const accounts = await store.accounts();
      for (const account of accounts) {
        if (account.status.startsWith('login_')) await login(account);
        else if (account.status === 'active' && !clients.has(account.id)) await connectAccount(account);
      }
      // Аккаунт удалили в админке — отключаемся.
      for (const [id, client] of clients) {
        if (!accounts.some((a) => a.id === id)) {
          clients.delete(id);
          sentIds.delete(id);
          await client.disconnect().catch(() => {});
        }
      }
      for (const row of await store.queued()) await send(row);
    },
  };
}
