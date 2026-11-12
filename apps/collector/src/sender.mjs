// Аккаунты Telegram, с которых мы пишем людям (docs/agents-inbox.md). Отдельно от читающего юзербота: блокировка
// пишущего аккаунта не должна останавливать сбор событий.
// Сборщик здесь — только транспорт: входит в аккаунт по шагам из админки, пересылает личные сообщения в API
// и отправляет то, что API положил в очередь. Что отвечать и кому — решает не он.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import telegram from 'telegram';
import { NewMessage, Raw } from 'telegram/events/index.js';
import { connect } from './mtproto.mjs';

const NO_TEXT = '[сообщение без текста]';
// Telegram повторяет «печатает» каждые ~5 с; API держит отметку 6 с, поэтому чаще раза в 4 с сообщать незачем.
const TYPING_EVERY_MS = 4000;

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

/**
 * `store` — запросы к базе (store.mjs), `report` — сообщить API о личном сообщении, `reportTyping` — что собеседник
 * набирает сообщение, `connectClient` — клиент MTProto (тесты подставляют свой). `tick()` делает один проход: шаги входа, подключение аккаунтов, отправка очереди.
 */
export function createSender({ store, apiId, apiHash, key, report, reportTyping = async () => {}, connectClient = connect, log = console.log }) {
  const clients = new Map(); // id аккаунта → подключённый клиент
  const logins = new Map(); // id аккаунта → { client, phoneCodeHash }: вход между шагами живёт только в памяти
  const sentIds = new Map(); // id аккаунта → номера сообщений, отправленных нами: о них в API не сообщаем

  function listen(account, client) {
    client.addEventHandler(async (event) => {
      try {
        const msg = event.message;
        if (!event.isPrivate || sentIds.get(account.id)?.has(msg.id)) return;
        const peer = await msg.getChat();
        if (!peer || peer.bot || peer.className !== 'User') return;
        await report({
          account_id: account.id,
          peer: { id: Number(peer.id), name: [peer.firstName, peer.lastName].filter(Boolean).join(' ') || String(peer.id), username: peer.username ?? null },
          direction: msg.out ? 'out' : 'in',
          text: msg.message || NO_TEXT,
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
        const { phoneCodeHash } = await client.sendCode({ apiId: Number(apiId), apiHash }, account.phone);
        logins.set(account.id, { client, phoneCodeHash });
        return await store.accountUpdate(account.id, { status: 'login_code', last_error: null });
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
    try {
      const client = connectClient({ apiId, apiHash, session: unseal(key, account.session) });
      await client.connect();
      // Список диалогов даёт клиенту адреса собеседников: без него после перезапуска некому ответить по id.
      await client.getDialogs({ limit: 100 });
      listen(account, client);
      log(`аккаунт ${account.label}: на связи`);
    } catch (e) {
      await store.accountUpdate(account.id, { status: 'error', last_error: code(e) });
      log(`аккаунт ${account.label}: не подключился: ${code(e)}`);
    }
  }

  async function send(row) {
    const client = clients.get(row.account_id);
    if (!client) return; // аккаунт ещё не на связи — сообщение подождёт в очереди
    try {
      // Ответ на вопрос в чате уходит реплаем в этот чат (аккаунт должен в нём состоять), остальное — в личку.
      const reply = row.meta?.reply_to;
      const sent = reply
        ? await client.sendMessage(/^-?\d+$/.test(reply.chat) ? Number(reply.chat) : reply.chat, { message: row.text, replyTo: reply.message_id })
        // По id — без запроса к Telegram; по username — запасной путь: поиск по нему флудоопасен.
        : await client.sendMessage(Number(row.peer_id), { message: row.text })
          .catch((e) => (row.peer_username ? client.sendMessage(row.peer_username, { message: row.text }) : Promise.reject(e)));
      sentIds.get(row.account_id).add(sent.id);
      await store.messageStatus(row.id, 'sent');
    } catch (e) {
      await store.messageStatus(row.id, 'failed');
      await store.accountUpdate(row.account_id, { last_error: `Не отправлено: ${code(e)}` });
      log(`очередь: сообщение ${row.id} не отправлено: ${code(e)}`);
    }
  }

  return {
    async tick() {
      const accounts = await store.accounts();
      for (const account of accounts) {
        if (account.status.startsWith('login_')) await login(account);
        else if (account.status === 'active' && !clients.has(account.id)) await connectAccount(account);
      }
      // Аккаунт удалили в админке — отключаемся.
      for (const [id, client] of clients) {
        if (!accounts.some((a) => a.id === id)) {
          clients.delete(id);
          await client.disconnect().catch(() => {});
        }
      }
      for (const row of await store.queued()) await send(row);
    },
  };
}
