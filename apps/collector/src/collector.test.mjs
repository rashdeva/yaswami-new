import assert from 'node:assert/strict';
import { signupUrl } from './signup.mjs';

const a = { url: 'https://t.me/danang/41' };

const t = 'Хочу на «{title}»';
const e = { title: 'Йога', telegram_username: null, whatsapp_phone: null, url: null };
const q = encodeURIComponent('Хочу на «Йога»');
assert.equal(signupUrl({ ...e, telegram_username: '@anna_yoga', url: 'https://x.co' }, a, t), `https://t.me/anna_yoga?text=${q}`);
assert.equal(signupUrl({ ...e, whatsapp_phone: '+84 90 123-45-67' }, a, t), `https://wa.me/84901234567?text=${q}`);
assert.equal(signupUrl({ ...e, url: 'https://x.co/f' }, a, t), 'https://x.co/f');
assert.equal(signupUrl({ ...e, telegram_username: 'a b', url: 'javascript:1' }, a, t), a.url);
console.log('ok');

const { looksLikeEvent, isSameEvent, mergeEvents } = await import('@yaswami/extract');
const pad = ' — приходите все, будет очень интересно и душевно';
assert.ok(looksLikeEvent('Йога на пляже в субботу в 7 утра' + pad));
assert.ok(looksLikeEvent('Networking night, Friday 8pm at the rooftop bar' + pad));
assert.ok(looksLikeEvent('Концерт 14.11, вход свободный' + pad));
assert.ok(!looksLikeEvent('Сдаётся квартира у моря, две спальни, недорого' + pad));
assert.ok(!looksLikeEvent('Завтра йога в 7:00'), 'слишком коротко');
console.log('prefilter ok');

// Ответ ИИ: неразборчивый — публикация без событий (источник не встаёт), событие с негодной датой отбрасывается одно.
const { parseExtracted } = await import('@yaswami/extract');
const extracted = { title: 'Йога', description: '', starts_at: '2026-11-20T07:00:00+07:00', ends_at: null, place: null, address: null, price: null, tags: [], telegram_username: 'anna', whatsapp_phone: null, url: null };
{
  const error = console.error;
  console.error = () => {};
  assert.deepEqual(parseExtracted('x/1', 'SAFETY', undefined), []);
  assert.deepEqual(parseExtracted('x/1', 'STOP', '{"events": [oops'), []);
  assert.deepEqual(parseExtracted('x/1', 'STOP', JSON.stringify({ events: [extracted, { ...extracted, starts_at: 'в субботу' }] })), [extracted]);
  console.error = error;
}
console.log('extract ok');

// Правила «что куда» называют только включённые темы: без «мафии» она идёт в «игры», туров без «путешествий» нет.
{
  const { topicRules, topicBoundaries } = await import('@yaswami/extract');
  const { TOPIC_GUIDES, setTopics } = await import('@yaswami/core');
  const saved = Object.entries(TOPIC_GUIDES).map(([name, g]) => ({ name, ...g }));
  const topic = (name) => ({ name, slug: name, emoji: '·', color: '#000000', what: '', why: '', first: '', not_for: '', icon_url: null });
  setTopics(['игры', 'спорт'].map(topic));
  assert.match(topicRules(), /мафия и похожие игры на социальную дедукцию — «игры»/);
  assert.doesNotMatch(topicRules(), /туры|путешествия|телесные/);
  setTopics(['игры', 'мафия', 'путешествия'].map(topic));
  assert.match(topicRules(), /дедукцию — «мафия»/);
  assert.match(topicRules(), /кэмпы .*— «путешествия»/);
  assert.doesNotMatch(topicRules(), /концерты/, 'без «музыки» концерты не уходят во «встречи»');
  setTopics([topic('кино')]);
  assert.equal(topicBoundaries('Границы: '), '', 'ни одного правила — ни одной оборванной фразы');
  setTopics(saved);
}
console.log('topic rules ok');

const { toAnnouncement } = await import('./mtproto.mjs');
const msg = { id: 7, message: 'Завтрак в пятницу', date: 1794366000, sender: { className: 'User', username: 'ivan', bot: false } };
assert.deepEqual(toAnnouncement('danangevent', msg), [{
  id: 'danangevent/7', number: 7, url: 'https://t.me/danangevent/7',
  published_at: new Date(1794366000 * 1000).toISOString(), image_url: null, author_username: 'ivan', text: 'Завтрак в пятницу',
}]);
assert.deepEqual(toAnnouncement('x', { ...msg, message: '' }), [], 'сообщение без текста');
assert.equal(toAnnouncement('x', { ...msg, sender: { className: 'Channel', username: 'x' } })[0].author_username, null, 'канал — не автор');
assert.deepEqual(toAnnouncement('x', { ...msg, sender: { bot: true } }), [], 'сообщение бота');
const { fetchChatAnnouncements } = await import('./mtproto.mjs');
const shot = (id, extra) => ({ id, message: '', date: 1794366000, groupedId: 5n, media: { className: 'MessageMediaPhoto' }, ...extra });
const albumClient = { connected: true, getMessages: async () => [shot(9), shot(8, { message: 'Йога в субботу' }), shot(7), { ...msg, id: 6 }] };
const got = await fetchChatAnnouncements(albumClient, 'yoga', 0);
assert.deepEqual(got.map((g) => [g.announcement.number, g.album.map((m) => m.id)]), [[8, [7, 8, 9]], [6, [6]]], 'альбом — все сообщения с тем же groupedId');
assert.equal('album' in got[0].announcement, false, 'сообщения Telegram не попадают в jsonb публикации');
console.log('mtproto ok');
// Найденные каналы переживают перезапуск: сессия GramJS отдаёт канал по username без поиска в Telegram.
{
  const { loadPeers, newPeers, goneReason } = await import('./mtproto.mjs');
  const { StringSession } = (await import('telegram/sessions/index.js')).default;
  const client = { session: new StringSession('') };
  loadPeers(client, [{ username: 'danang_yoga', peer_id: '-1001234567890', access_hash: '987654321' }]);
  const peer = client.session.getInputEntity('danang_yoga');
  assert.deepEqual([peer.className, String(peer.channelId), String(peer.accessHash)], ['InputPeerChannel', '1234567890', '987654321']);
  client.session._entities.add(['-1005', '55', 'new_chat', undefined, 'Новый чат']);
  client.session._entities.add(['42', '7', 'some_person', undefined, 'Человек']); // людей не храним: только каналы и группы
  assert.deepEqual(newPeers(client, new Set(['danang_yoga'])), [{ username: 'new_chat', peer_id: '-1005', access_hash: '55' }]);
  assert.equal(goneReason(new Error('No user has "dancehalldanang" as username')), 'В Telegram нет канала с таким username');
  assert.equal(goneReason({ errorMessage: 'CHANNEL_PRIVATE', message: '400: CHANNEL_PRIVATE' }), 'Канал удалён или стал закрытым');
  assert.equal(goneReason(new Error('FLOOD_WAIT_300')), null, 'временная ошибка источник не выключает');
}
console.log('peers ok');
assert.equal(toAnnouncement('-1001234567890', msg)[0].url, 'https://t.me/c/1234567890/7', 'ссылка закрытого канала');

const ev = (title, starts_at, telegram_username = null, extra = {}) =>
  ({ title, description: '', starts_at, ends_at: null, place: null, price: null, telegram_username, whatsapp_phone: null, ...extra });
const D = '2026-11-13T12:00:00+07:00';
assert.ok(isSameEvent(ev('Завтрак с расстановками', D, 'igor'), ev('Завтрак с расстановками: знакомство', D, 'Igor')), 'тот же контакт и время');
assert.ok(isSameEvent(ev('Коллажный кружок', D), ev('Коллажный кружок', D, 'rita')), 'то же название и время');
assert.ok(isSameEvent(ev('Коллажная встреча', '2026-11-13T00:00:00+07:00', 'rita'), ev('Коллажный кружок', D, 'rita')), 'время не указано');
assert.ok(!isSameEvent(ev('Завтрак с нумерологом', D, 'a'), ev('Завтрак с регрессологом', D, 'b')), 'разные события в одно время');
assert.ok(!isSameEvent(ev('Бачата', D, 'k'), ev('Бачата', '2026-11-14T12:00:00+07:00', 'k')), 'разные дни');
assert.ok(!isSameEvent(ev('Йога утром', '2026-11-13T07:00:00+07:00', 'k'), ev('Йога вечером', '2026-11-13T19:00:00+07:00', 'k')), 'один организатор, разное время');
const m = mergeEvents(ev('Коллажная встреча', '2026-11-13T00:00:00+07:00', 'rita'), ev('Коллажный кружок', D, null, { place: 'Дом Культуры', price: '100k' }));
assert.deepEqual([m.title, m.starts_at, m.place, m.price, m.telegram_username], ['Коллажная встреча', D, 'Дом Культуры', '100k', 'rita']);
console.log('dedupe ok');
assert.deepEqual(mergeEvents({ ...ev('Баня', D), what_happens: [] }, { ...ev('Баня', D), what_happens: ['Парение'] }).what_happens, ['Парение'], 'пустой список дополняется из повторного анонса');

// Темы: реестр ядра — из базы; новая тема — из метки-кандидата, одна за проход; отказ ИИ запоминается.
{
  const { TOPIC_GUIDES, setTopics } = await import('@yaswami/core');
  const { curateTopics, syncTopics } = await import('./topics.mjs');
  const builtIn = Object.entries(TOPIC_GUIDES).map(([name, g]) => ({ name, ...g }));
  const rows = [{ name: 'йога', slug: 'yoga', emoji: '🧘', color: '#e8891a', what: 'w', why: 'y', first: 'f', not_for: 'n' }];
  const candidates = [{ tag: 'новый год', inside: 'обучение', events_count: 9, hosts_count: 5, examples: [] }, { tag: 'падел', inside: 'спорт', events_count: 6, hosts_count: 3, examples: [] }];
  const moved = [];
  const asked = [];
  const store = {
    topics: async () => rows,
    topicCandidates: async (limits) => (assert.deepEqual(limits, { minEvents: 5, minHosts: 3, splitEvents: 10, splitHosts: 5 }), candidates),
    addTopic: async (t, from) => (rows.push(t), moved.push(from), true),
  };
  const proposeTopic = async (c) => (asked.push(c.tag), c.tag === 'падел' ? { name: 'ракеточный спорт', slug: 'racket', emoji: '🏓', color: '#0ea5e9', what: 'w', why: 'y', first: 'f', not_for: 'n', tags: ['падел'] } : null);
  assert.equal(await syncTopics({ store }), 1);
  assert.deepEqual(Object.keys(TOPIC_GUIDES), ['йога'], 'реестр заменён списком из базы');
  assert.equal(await curateTopics({ store, proposeTopic }), null, '«новый год» — не тема');
  assert.equal(await curateTopics({ store, proposeTopic }), 'ракеточный спорт');
  assert.deepEqual(asked, ['новый год', 'падел'], 'об отклонённой метке второй раз не спрашиваем');
  assert.deepEqual(moved, [{ from: 'спорт', tag: 'падел' }], 'тема выделена из широкой: её события с меткой переедут');
  assert.deepEqual(Object.keys(TOPIC_GUIDES), ['йога', 'ракеточный спорт'], 'новая тема сразу в реестре: следующий анонс её получит');
  setTopics(builtIn);
}

const { backfillTopics } = await import('./backfill.mjs');
const saved = {};
await backfillTopics({
  store: {
    withoutTopic: async () => [
      { external_id: 'a#0', announcement: { id: 'a' }, event: ev('Баня', D, 'igor', { price: '450k' }) },
      { external_id: 'a#1', announcement: { id: 'a' }, event: ev('Киноклуб', '2026-11-20T19:00:00+07:00') },
      { external_id: 'b#0', announcement: { id: 'b' }, event: ev('Лекция', D) },
    ],
    setEvent: async (id, event) => { saved[id] = event; },
  },
  extract: async (a) => a.id === 'b' ? Promise.reject(new Error('503')) : [ev('Вечер в бане', D, 'igor', { price: 'другая', topic: 'баня', what_happens: ['Парение'], takeaway: null })],
  pause: async () => {},
});
assert.deepEqual([saved['a#0'].topic, saved['a#0'].what_happens, saved['a#0'].price, saved['a#0'].title], ['баня', ['Парение'], '450k', 'Баня'], 'дописаны только новые поля');
assert.equal(saved['a#1'].topic, 'другое', 'не найденное при повторном разборе помечается, чтобы не разбирать снова');
assert.equal('b#0' in saved, false, 'анонс, на котором ИИ упал, не помечается и не мешает остальным');
console.log('backfill ok');

const { refreshOld } = await import('./refresh.mjs');
const refreshed = {};
const old = (id, title, description) => ({ external_id: id, announcement: { id: id.split('#')[0] }, event: ev(title, D, 'igor', { description }) });
await refreshOld({
  store: {
    withoutMedia: async () => [old('c/1#0', 'Баня', 'Баня.'), old('c/2#0', 'Лекция', 'Лекция.'), old('c/3#0', 'Удалено', 'x'), old('c/4#0', 'Сбой', 'x')],
    refreshed: async (id, event, media) => { refreshed[id] = { event, media }; },
  },
  fetchAlbum: async (id) => id === 'c/3' ? null : [{ id: 1 }],
  downloadPhotos: async () => [{ number: 1, data: Buffer.from('jpg') }],
  extract: async (a) => a.id === 'c/4' ? Promise.reject(new Error('503')) : [ev(a.id === 'c/1' ? 'Баня' : 'Другое', D, 'igor', { description: 'Полное описание с программой.' })],
  saveMedia: async () => [{ type: 'photo', url: 'https://m/1.jpg' }],
  pause: async () => {}, limit: 10,
});
assert.equal(refreshed['c/1#0'].event.description, 'Полное описание с программой.', 'описание заменено полным');
assert.deepEqual(refreshed['c/1#0'].media, [{ type: 'photo', url: 'https://m/1.jpg' }]);
assert.ok(refreshed['c/2#0'], 'событие осталось прежним, но публикация отмечена разобранной');
assert.deepEqual(refreshed['c/3#0'].media, [], 'удалённая публикация отмечена, чтобы не спрашивать снова');
assert.equal('c/4#0' in refreshed, false, 'сбой ИИ — повторим в следующий проход');
console.log('refresh ok');

const { channelFromBio, contactFor, fetchChannelPhotos, pickThumb } = await import('./host.mjs');
const noContact = { telegram_username: null, whatsapp_phone: null };
assert.equal(contactFor({ ...noContact, telegram_username: '@Anna' }, 'yoga_news', null), '@Anna');
assert.equal(contactFor({ ...noContact, telegram_username: '@Yoga_News' }, 'yoga_news', null), null, 'канал-источник — не контакт');
assert.equal(contactFor({ ...noContact, telegram_username: 'yoga_news' }, 'yoga_news', 'anna'), 'anna', 'в канале организатора контакт — он сам');
assert.equal(contactFor({ ...noContact, whatsapp_phone: '+84 90' }, 'yoga_news', 'anna'), null, 'есть WhatsApp — организатора не подставляем');
assert.equal(contactFor(noContact, 'tea_house', 'Tea_House'), null, 'организатор — сама площадка');
assert.equal(channelFromBio('Веду йогу. Канал: t.me/anna_yoga_life, запись @anna_yoga', 'anna_yoga'), 'anna_yoga_life');
assert.equal(channelFromBio('Запись @Anna_Yoga, почта anna@gmail.com, t.me/joinchat/abc, @yoga_bot', 'anna_yoga'), null, 'сам контакт, почта, приглашение, бот');
assert.equal(channelFromBio(null, 'anna_yoga'), null);
console.log('host ok');

const sizes = [{ type: 'i' }, { type: 'm', w: 320, h: 213 }, { type: 'x', w: 800, h: 533 }, { type: 'y', w: 1280, h: 853 }];
assert.equal(pickThumb(sizes), 'm', 'самое маленькое превью от 320px');
assert.equal(pickThumb([{ type: 'i' }, { type: 's', w: 100, h: 67 }]), 's', 'мелкая картинка — берём что есть');
assert.equal(pickThumb([{ type: 'i' }]), null, 'размеров нет');
const jpeg = Buffer.from([0xff, 0xd8, 1, 2]);
const post = (id, media) => ({ id, media });
const photo = { className: 'MessageMediaPhoto', photo: { sizes } };
const fake = {
  connected: true,
  getMessages: async () => [post(9, photo), post(8, { className: 'MessageMediaWebPage' }), post(7, photo), post(6, null), post(5, photo)],
  downloadMedia: async (m, { thumb }) => (assert.equal(thumb, 'm'), m.id === 5 ? Buffer.from('<html>') : jpeg),
};
assert.deepEqual(await fetchChannelPhotos(fake, 'anna', ['telegram:anna/9']), {
  sources: ['telegram:anna/9', 'telegram:anna/7', 'telegram:anna/5'],
  added: [{ source: 'telegram:anna/7', data: jpeg }],
}, 'только фото публикаций; известное не качаем, не-JPEG не сохраняем');
assert.equal(await fetchChannelPhotos({ ...fake, getMessages: async () => { throw new Error('CHANNEL_PRIVATE'); } }, 'anna'), null);
console.log('photos ok');

const { toStats } = await import('./mtproto.mjs');
assert.deepEqual(toStats({ views: 1200, reactions: { results: [{ count: 7 }, { count: 3 }] } }), { views: 1200, reactions: 10 });
assert.deepEqual(toStats({}), { views: null, reactions: 0 }, 'публикация в группе без реакций');
console.log('stats ok');

const { downloadCover } = await import('./mtproto.mjs');
const coverJpeg = Buffer.from([0xff, 0xd8, 1, 2]);
const photoMsg = { media: { className: 'MessageMediaPhoto', photo: { sizes: [{ type: 'm', w: 320, h: 180 }, { type: 'x', w: 800, h: 450 }, { type: 'y', w: 1280, h: 720 }] } } };
const asked = [];
const dl = { downloadMedia: async (_m, o) => { asked.push(o.thumb); return coverJpeg; } };
assert.equal(await downloadCover(dl, photoMsg), coverJpeg);
assert.deepEqual(asked, ['x'], 'берём превью 800, а не 320 и не оригинал');
assert.equal(await downloadCover(dl, { media: { className: 'MessageMediaWebPage' } }), null, 'картинка из предпросмотра ссылки — не обложка');
assert.equal(await downloadCover({ downloadMedia: async () => Buffer.from('png?') }, photoMsg), null, 'не JPEG');
console.log('cover ok');
// Аккаунты для переписки: вход по шагам, приём и отправка — на поддельном клиенте Telegram и хранилище в памяти.
{
  const { createSender, seal, unseal } = await import('./sender.mjs');
  const key = 'ab'.repeat(32);
  assert.equal(unseal(key, seal(key, 'сессия')), 'сессия');
  assert.throws(() => unseal('cd'.repeat(32), seal(key, 'сессия')), 'чужим ключом не открыть');

  const account = { id: 'a1', label: 'Аня', phone: '+84900000001', status: 'login_requested', session: null, login: null };
  const queue = [];
  const reported = [];
  const store = {
    accounts: async () => [account],
    accountUpdate: async (_id, fields) => void Object.assign(account, fields),
    queued: async () => queue.filter((m) => m.status === 'queued'),
    messageStatus: async (id, status) => void (queue.find((m) => m.id === id).status = status),
    claim: async (id) => { const m = queue.find((m) => m.id === id); if (m.status !== 'queued') return false; m.status = 'sending'; return true; },
    failStuck: async () => queue.filter((m) => m.status === 'sending').forEach((m) => (m.status = 'failed')),
  };
  const fail = (errorMessage) => Object.assign(new Error(errorMessage), { errorMessage });
  let handler;
  let typingHandler;
  const typing = [];
  const sentTo = [];
  const client = {
    session: { save: () => 'SESSION' },
    connect: async () => {},
    sendCode: async () => ({ phoneCodeHash: 'hash' }),
    invoke: async (request) => { throw fail(request.phoneCode === '11111' ? 'SESSION_PASSWORD_NEEDED' : 'PHONE_CODE_INVALID'); },
    signInWithPassword: async (_api, { password }) => { if ((await password()) !== 'верный') throw fail('PASSWORD_HASH_INVALID'); },
    addEventHandler: (fn, builder) => { if (builder?.constructor?.name === 'Raw') typingHandler = fn; else handler = fn; },
    getDialogs: async () => [],
    sendMessage: async (peer, { message }) => { if (peer === 42) throw fail('PEER_ID_INVALID'); sentTo.push([peer, message]); return { id: 900 }; },
    disconnect: async () => {},
  };
  const sender = createSender({ store, apiId: '1', apiHash: 'h', key, report: async (m) => void reported.push(m), reportTyping: async (t) => void typing.push(t), connectClient: () => client, log: () => {} });

  await sender.tick();
  assert.equal(account.status, 'login_code', 'код запрошен');
  assert.match(account.last_error, /по СМС/, 'код ушёл не в приложение — в админке подсказка');
  await sender.tick();
  assert.equal(account.status, 'login_code', 'без кода ждём');
  account.login = { secret: '00000' };
  await sender.tick();
  assert.deepEqual([account.status, account.login, account.last_error], ['login_code', null, 'Неверный код']);
  account.login = { secret: '11111' };
  await sender.tick();
  assert.deepEqual([account.status, account.login], ['login_password', null], 'нужен пароль, код стёрт');
  account.login = { secret: 'не тот' };
  await sender.tick();
  assert.deepEqual([account.status, account.last_error], ['login_password', 'Неверный пароль']);
  account.login = { secret: 'верный' };
  await sender.tick();
  assert.deepEqual([account.status, account.login, unseal(key, account.session)], ['active', null, 'SESSION'], 'вошли, сессия зашифрована');

  // Входящее личное сообщение уходит в API; сообщение из группы и от бота — нет.
  const user = { className: 'User', id: 42n, firstName: 'Тим', lastName: null, username: 'tim', bot: false };
  await handler({ isPrivate: true, message: { id: 1, out: false, message: 'Привет', getChat: async () => user } });
  await handler({ isPrivate: false, message: { id: 2, out: false, message: 'в группе', getChat: async () => user } });
  await handler({ isPrivate: true, message: { id: 3, out: false, message: 'я бот', getChat: async () => ({ ...user, bot: true }) } });
  assert.deepEqual(reported, [{ account_id: 'a1', peer: { id: 42, name: 'Тим', username: 'tim' }, direction: 'in', text: 'Привет' }]);

  // «Печатает» уходит в API не чаще раза в несколько секунд; «перестал печатать» — нет.
  await typingHandler({ userId: 42n, action: { className: 'SendMessageTypingAction' } });
  await typingHandler({ userId: 42n, action: { className: 'SendMessageTypingAction' } });
  await typingHandler({ userId: 43n, action: { className: 'SendMessageCancelAction' } });
  assert.deepEqual(typing, [{ account_id: 'a1', peer_id: 42 }]);

  // Очередь: по id не вышло — отправляем по username; своё отправленное в API не возвращаем.
  queue.push({ id: 'm1', text: 'Здравствуйте!', account_id: 'a1', peer_id: '42', peer_username: 'tim', status: 'queued' });
  queue.push({ id: 'm2', text: 'Без адреса', account_id: 'a1', peer_id: '42', peer_username: null, status: 'queued' });
  await sender.tick();
  assert.deepEqual(sentTo, [['tim', 'Здравствуйте!']]);
  assert.deepEqual(queue.map((m) => m.status), ['sent', 'failed']);
  await handler({ isPrivate: true, message: { id: 900, out: true, message: 'Здравствуйте!', getChat: async () => user } });
  await handler({ isPrivate: true, message: { id: 901, out: true, message: 'пишу сам из Telegram', getChat: async () => user } });
  assert.deepEqual(reported.slice(1).map((m) => [m.direction, m.text]), [['out', 'пишу сам из Telegram']]);
  // Утверждённый ответ на вопрос в чате уходит реплаем в чат, а не в личку.
  client.sendMessage = async (peer, options) => { sentTo.push([peer, options]); return { id: 902 }; };
  queue.push({ id: 'm3', text: 'Сегодня бачата в 19:00', account_id: 'a1', peer_id: '42', peer_username: 'tim', status: 'queued', meta: { reply_to: { chat: 'danang_chat', message_id: 3 } } });
  await sender.tick();
  assert.deepEqual(sentTo.at(-1), ['danang_chat', { message: 'Сегодня бачата в 19:00', replyTo: 3 }]);
  // На наш ответ в чате ответили — это уходит в API с адресом, куда отвечать; чужие разговоры в чате — нет.
  const group = { className: 'Channel', id: 500n, username: 'danang_chat' };
  const inGroup = (message) => handler({ isPrivate: false, message: { out: false, getChat: async () => group, getSender: async () => user, ...message } });
  await inGroup({ id: 10, message: 'А сколько стоит?', mentioned: true, replyTo: { replyToMsgId: 902 } });
  await inGroup({ id: 11, message: 'не нам', mentioned: false, replyTo: { replyToMsgId: 5 } });
  await inGroup({ id: 12, message: 'закрытый чат', mentioned: true, replyTo: { replyToMsgId: 902 }, getChat: async () => ({ ...group, username: null }) });
  assert.deepEqual(reported.slice(2).map((m) => [m.direction, m.text, m.reply_to]), [
    ['in', 'А сколько стоит?', { chat: 'danang_chat', message_id: 10 }], ['in', 'закрытый чат', { chat: '-100500', message_id: 12 }],
  ]);
  // PEER_FLOOD: Telegram ограничил аккаунт — сообщение возвращается в черновики, первые сообщения на паузе.
  client.sendMessage = async () => { throw fail('PEER_FLOOD'); };
  queue.push({ id: 'm4', text: 'Привет! Видел в чате…', account_id: 'a1', peer_id: '77', peer_username: 'anya', status: 'queued' });
  await sender.tick();
  assert.equal(queue.at(-1).status, 'draft', 'не потеряно — снова черновик');
  assert.ok(account.cold_paused_until > new Date(Date.now() + 2 * 86_400_000), 'пауза на дни');
  assert.match(account.last_error, /PEER_FLOOD/);
  console.log('sender ok');
}

// Вопросы «куда сходить» в больших чатах: отбор без ИИ.
{
  const { looksLikeLead, pickLeads, signalOf } = await import('./lead.mjs');
  for (const yes of ['Ребят, куда сегодня можно сходить потанцевать?', 'Чем заняться в Дананге вечером?', 'Есть какие-нибудь мероприятия на выходных?',
    'Подскажите, куда пойти с ребёнком', 'Ищу компанию на покер', 'Где тут можно поиграть в настолки?', "What's on tonight?", 'any events this weekend?',
    'Кто идёт сегодня на концерт?', 'Где в эту пятницу квиз?', 'Есть тут йога по утрам?']) {
    assert.ok(looksLikeLead(yes), yes);
  }
  for (const no of ['Сдаю байк, недорого', 'Куда пропал свет на Ми Кхе?', 'Продам доску для сёрфа', 'Где купить сим-карту?', 'Вчера был отличный концерт', 'А кто сказал, что можно дистанционно?', 'ок', 'Куда сходить? ' + 'очень длинный текст '.repeat(30)]) {
    assert.ok(!looksLikeLead(no), no);
  }
  const now = 1_800_000_000_000;
  const at = (minutesAgo) => now / 1000 - minutesAgo * 60;
  const user = { className: 'User', id: 42n, firstName: 'Даша', lastName: 'К', username: 'dasha_k', bot: false };
  const leads = pickLeads('danang_chat', [
    { id: 1, date: at(30), message: 'Всем привет', sender: user },
    { id: 2, date: at(29), message: 'Погода огонь', sender: user },
    { id: 3, date: at(28), message: 'Куда сегодня сходить потанцевать?', sender: user },
    { id: 4, date: at(2 * 24 * 60), message: 'Куда сходить вечером?', sender: user }, // старше суток — для истории есть backfill
    { id: 5, date: at(5), message: 'Чем заняться вечером?', sender: { ...user, bot: true } }, // бот
    { id: 6, date: at(4), message: 'Чем заняться вечером?', sender: { className: 'Channel', id: 7n } }, // от имени канала
    { id: 7, date: at(300), message: 'Ищу партнёра на бачату по четвергам', sender: user }, // ищет компанию: часы назад — в личку решит API
  ], now);
  assert.deepEqual(leads.map(({ message_id, signal, sent_at }) => [message_id, signal, sent_at]), [
    [3, 'ask', new Date(at(28) * 1000).toISOString()],
    [7, 'seek', new Date(at(300) * 1000).toISOString()],
  ]);
  assert.deepEqual(leads[0], {
    signal: 'ask', sent_at: new Date(at(28) * 1000).toISOString(),
    chat: 'danang_chat', message_id: 3, url: 'https://t.me/danang_chat/3',
    author: { id: 42, name: 'Даша К', username: 'dasha_k' },
    text: 'Куда сегодня сходить потанцевать?', context: ['Всем привет', 'Погода огонь'],
  });
  // За неделю (разовая догрузка) берётся и старое.
  assert.deepEqual(pickLeads('danang_chat', [{ id: 4, date: at(2 * 24 * 60), message: 'Куда сходить вечером?', sender: user }], now, 7 * 86_400_000).map((l) => l.message_id), [4]);
  assert.equal(signalOf('Только приехала, хочу познакомиться'), 'newcomer');
  assert.equal(signalOf('Ищу партнёра по бизнесу'), null, 'не досуг');
  assert.equal(signalOf('Посоветуйте хорошего массажиста в Дананге'), 'service');
  assert.equal(signalOf('Ищу тренера по теннису для ребёнка'), 'service');
  assert.equal(signalOf('Ищем тренера в нашу студию, график работы 5/2, зарплата от 15 млн, пишите в личку'), null, 'наём — не просьба об услуге');
  assert.equal(signalOf('Массаж спины, провожу индивидуально, запись в лс'), null, 'мастер предлагает, а не ищет');
  assert.equal(signalOf('Ищу няню для ребёнка 3 лет'), null, 'наём — не услуга из каталога');
  assert.equal(signalOf('Девочки, где купить нормальный творог?'), 'product');
  assert.equal(signalOf('Кто печёт бенто-торты на заказ?'), 'product');
  assert.equal(signalOf('Подскажите, где взять хлеб на закваске'), 'product');
  assert.equal(signalOf('Пельмени домашние, 250к за кг, доставка, пишите в лс'), null, 'мастер продаёт, а не ищет');
  assert.equal(signalOf('Ищем кондитера в кафе, торты, зарплата от 12 млн'), null, 'наём — не товар');
  console.log('leads ok');
}

// Кандидаты в Находки по Запросам организаторов: отбор по ключевым словам без ИИ.
{
  const { pickSearchCandidates } = await import('./lead.mjs');
  const now = 1_800_000_000_000;
  const at = (minutesAgo) => now / 1000 - minutesAgo * 60;
  const user = { className: 'User', id: 42n, firstName: 'Лена', username: 'lena', bot: false };
  const searches = [
    { id: 's1', query: 'ищут массаж', keywords: ['массаж', 'спин'], host_telegram_id: 7 },
    { id: 's2', query: 'ищут йогу', keywords: ['йог', 'yoga'], host_telegram_id: 8 },
    { id: 's3', query: 'новый', keywords: null, host_telegram_id: 9 }, // слова ещё не выведены
  ];
  const picked = pickSearchCandidates('danang_chat', [
    { id: 1, date: at(10), message: 'Болит спина, посоветуйте массажиста', sender: user },
    { id: 2, date: at(9), message: 'Где тут Yoga по утрам?', sender: user },
    { id: 3, date: at(8), message: 'Делаю массаж, пишите', sender: { ...user, id: 7n } }, // сам организатор
    { id: 4, date: at(7), message: 'Убегаю на рынок', sender: user }, // «бег» не с начала слова — и так не в словах
    { id: 5, date: at(6), message: 'Нужен массаж', sender: { ...user, bot: true } }, // бот
    { id: 6, date: at(2 * 24 * 60), message: 'Нужен массаж', sender: user }, // старше суток
    { id: 7, date: at(5), message: 'Массаж ' + 'очень длинное объявление '.repeat(30), sender: user }, // объявление
    { id: 8, date: at(4), message: 'Пропилен в спинке кресла', sender: user }, // «спин» с начала слова «спинке» — пусть решает ИИ
    { id: 9, date: at(3), message: 'Подойдёт и ремонт', sender: user },
  ], searches, now);
  assert.deepEqual(picked.map((c) => [c.message_id, c.searches.map((s) => s.id)]), [[1, ['s1']], [2, ['s2']], [8, ['s1']]]);
  assert.deepEqual(picked[0], {
    sent_at: new Date(at(10) * 1000).toISOString(), chat: 'danang_chat', message_id: 1, url: 'https://t.me/danang_chat/1',
    author: { id: 42, name: 'Лена', username: 'lena' }, text: 'Болит спина, посоветуйте массажиста', searches: [{ id: 's1', query: 'ищут массаж' }],
  });
  assert.deepEqual(pickSearchCandidates('danang_chat', [{ id: 1, date: at(1), message: 'массаж', sender: user }], []), []);
  console.log('host searches ok');
}

// Разведка: активность чата и люди с интересом к досугу.
{
  const { chatStats, pickCandidates } = await import('./scout.mjs');
  const now = 1_800_000_000_000;
  const daysAgo = (d) => now / 1000 - d * 86400;
  const user = (id, username = `u${id}`) => ({ className: 'User', id: BigInt(id), username, firstName: 'И', bot: false });
  const messages = [
    { id: 1, date: daysAgo(1), message: 'Куда сходить вечером?', sender: user(1) },
    { id: 2, date: daysAgo(20), message: 'Ищу партнёра на бачату, кто со мной?', sender: user(2) },
    { id: 3, date: daysAgo(2), message: 'Ищу партнёра на бачату по четвергам', sender: user(2) },
    { id: 4, date: daysAgo(10), message: 'Только приехала, хочу познакомиться', sender: user(3) },
    { id: 5, date: daysAgo(1), message: 'Сдаю байк', sender: user(4) },
    { id: 6, date: daysAgo(1), message: 'Ищу партнёра по бизнесу', sender: user(5) }, // не досуг
    { id: 7, date: daysAgo(1), message: 'Чем заняться вечером?', sender: { ...user(6), bot: true } }, // бот
    { id: 8, date: daysAgo(40), message: 'Куда сходить?', sender: user(7) }, // за окном
  ];
  const found = pickCandidates('danang_chat', messages, 30, now);
  assert.deepEqual(found.map((c) => [c.author.username, c.score, c.topic]), [
    ['u2', 10, 'бачат'], // 3 × 3 (свежее) + 1 повтор
    ['u1', 6, null],
    ['u3', 2, null],
  ]);
  assert.equal(found[0].url, 'https://t.me/danang_chat/3');
  assert.deepEqual(chatStats(messages, 30, now), { per_day: 0, authors: 5 });
  console.log('scout ok');
}

// Мастера: самопредставление в чате.
{
  const { looksLikeOffer, pickOffers, saveOffers } = await import('./offers.mjs');
  const svetlana = 'Здравствуйте! Меня зовут Светлана, я тренер-реабилитолог, опыт 20 лет. Провожу индивидуальные занятия и группы по восстановлению спины. Стоимость 400k, пишите в личку.';
  assert.ok(looksLikeOffer(svetlana));
  assert.ok(!looksLikeOffer('Посоветуйте хорошего массажиста в районе Ан Тхыонг, пожалуйста, очень нужно на этой неделе, спина болит после перелёта'), 'ищет мастера, а не предлагает');
  assert.ok(!looksLikeOffer('Провожу массаж'), 'слишком коротко');
  // Бытовые услуги (ADR-0012): мастер красоты не пишет «провожу» и «тренер», но его тоже берём.
  assert.ok(looksLikeOffer('Девочки, маникюр и педикюр с покрытием в Ан Тхыонг, наращивание ресниц. Стерильные инструменты, кофе в подарок. Маникюр 250k, ресницы от 400k. Пишите в лс!'));
  assert.ok(looksLikeOffer('Генеральная уборка квартир и вилл, мытьё окон, химчистка диванов. Работаем командой, свои средства. Стоимость от 300k за квартиру, записывайтесь заранее.'));
  const user = (id, username) => ({ className: 'User', id: BigInt(id), firstName: 'Светлана', username, bot: false });
  const offers = pickOffers('danang_women', [
    { id: 1, message: svetlana, sender: user(7, 'Sveta_Rehab') },
    { id: 2, message: svetlana + ' Повтор.', sender: user(7, 'Sveta_Rehab') }, // одна строка на человека — последняя
    { id: 3, message: svetlana, sender: user(8, null) }, // без username и контакта в тексте не написать
    // реклама через бота чата: мастер — контакт из текста, кто он — найдёт saveOffers
    { id: 4, message: svetlana + ' Запись: @Masha_Massage, чат t.me/danang_women', sender: { className: 'User', id: 1n, username: 'ads_bot', bot: true } },
  ]);
  assert.deepEqual(offers.map((o) => [o.url, o.author]), [
    ['https://t.me/danang_women/2', { id: 7, name: 'Светлана', username: 'sveta_rehab' }],
    ['https://t.me/danang_women/4', { id: null, name: null, username: 'masha_massage' }],
  ]);

  const saved = [];
  const store = { hasPractices: async (id) => id === 9, saveOffer: async (h) => saved.push(h) };
  const practice = { title: 'Реабилитация спины', topic: 'спорт', description: null, price: '400k' };
  const extractOffer = async () => ({ summary: 'Тренер-реабилитолог.', practices: [practice] });
  const known = { url: 'x', author: { id: 9, name: 'Уже есть', username: 'known' }, text: svetlana };
  const resolve = async (u) => (u === 'masha_massage' ? { id: 12, name: 'Маша' } : null);
  assert.equal(await saveOffers({ store, extractOffer, resolve, pause: async () => {} }, [...offers, known]), 2);
  assert.deepEqual(saved, [
    { telegram_id: 7, username: 'sveta_rehab', name: 'Светлана', summary: 'Тренер-реабилитолог.', practices: [practice], offer_url: 'https://t.me/danang_women/2' },
    { telegram_id: 12, username: 'masha_massage', name: 'Маша', summary: 'Тренер-реабилитолог.', practices: [practice], offer_url: 'https://t.me/danang_women/4' },
  ]);
  console.log('offers ok');
}

// Чат города: вопросы, мастера и кандидаты в Находки из одних сообщений.
{
  const { pickFromChat } = await import('./lead.mjs');
  const now = Math.floor(Date.now() / 1000);
  const user = (id, username) => ({ className: 'User', id: BigInt(id), firstName: 'Олег', username, bot: false });
  const svetlana = 'Здравствуйте! Меня зовут Светлана, я тренер-реабилитолог, опыт 20 лет. Провожу индивидуальные занятия и группы по восстановлению спины. Стоимость 400k, пишите в личку.';
  const messages = [
    { id: 3, date: now, message: 'Куда сходить вечером?', sender: user(7, 'u7') },
    { id: 4, date: now, message: svetlana, sender: user(8, 'sveta_rehab') },
    { id: 7, date: now, message: 'Ищу работу тренером в Дананге, опыт 5 лет, готов выйти сразу', sender: user(9, 'cook') },
    { id: 8, date: now, message: 'Посоветуйте хорошего массажиста в Дананге', sender: user(10, 'u10') },
  ];
  const searches = [{ id: 's1', query: 'ищут, куда сходить', keywords: ['сходить'], host_telegram_id: 1 }];
  const all = pickFromChat('danang_chat', messages, { searches });
  assert.deepEqual(all.leads.map((l) => [l.message_id, l.signal]), [[3, 'ask'], [8, 'service']], 'кто ищет работу — не просьба об услуге');
  assert.deepEqual([all.offers.length, all.candidates.length], [1, 1]);
  console.log('chat ok');
}

// Поиск источников: контакты из текста сообщения.
{
  const { contactsIn } = await import('./find-sources.mjs');
  assert.deepEqual(contactsIn('Пишите @Surf_Bob или t.me/surfdanang, чат t.me/joinchat/AbC, почта a@b.co'), ['surf_bob', 'surfdanang']);
  console.log('find-sources ok');
}

// Город разовых скриптов: канал «про город», если в названии есть основа любого написания города.
{
  const { cityMatcher, chatsToRead } = await import('./city.mjs');
  const local = cityMatcher(['Дананг', 'Da Nang', 'Хойан']);
  assert.ok(['Футбол в Дананге', 'DaNang surf', 'da nang yoga', 'Хойан танцы'].every((t) => local.test(t)));
  assert.ok(!local.test('Нячанг футбол'));
  assert.ok(cityMatcher(['Ханой']).test('Йога в Ханое'));
  assert.ok(cityMatcher(['St. Petersburg (SPb)']).test('Йога st. petersburg (spb)'), 'спецсимволы названия — как текст');
  assert.ok(!cityMatcher(['St. Petersburg']).test('stx petersburg'));
  // Город — отдельным словом: Galle не находит галереи, Kandy — чужие ники, Элла — «Эллу» находит, «Эллипс» — нет.
  const galle = cityMatcher(['Галле', 'Galle']);
  assert.ok(['Йога в Галле', 'Galle Fort events', 'gt_galle', 'Галле Форт'].every((t) => galle.test(t)));
  assert.ok(!['GT Gallery GT_Gallery', 'Yoga Gallery yoga_gallery', 'Begim Parfum begimparfumgallery', 'gallyam2022'].some((t) => galle.test(t)));
  assert.ok(!cityMatcher(['Канди', 'Kandy']).test('Kandybaaa kandybaaa'));
  assert.ok(cityMatcher(['Элла', 'Ella']).test('Йога в Элле') && !cityMatcher(['Элла', 'Ella']).test('Эллипс ellaindo'));
  // В username длинное название склеено со словом — это всё ещё город.
  assert.ok(['danangevent', 'da_nang_chat', 'Афиша danangpals'].every((t) => local.test(t)));
  assert.ok(['eventnhatrang', 'afisha_nhatrang'].every((t) => cityMatcher(['Нячанг', 'Nha Trang']).test(t)));
  // Чаты разовых скриптов: без аргументов — чаты города из источников; чат не из базы — в первом городе.
  const store = {
    chats: async () => [{ chat: 'Big', city_id: 'hanoi', city: 'Ханой' }],
    cities: async () => [{ id: 'danang', name: 'Дананг' }, { id: 'hanoi', name: 'Ханой' }],
  };
  assert.deepEqual((await chatsToRead(store, [])).map((c) => c.chat), ['Big']);
  assert.deepEqual((await chatsToRead(store, ['@big', 'other'])).map((c) => [c.chat, c.city_id, c.city]), [['Big', 'hanoi', 'Ханой'], ['other', 'danang', 'Дананг']]);
}

// Instagram: публикация в анонс, запись в директ, хэштеги города, кандидаты в источники, запуск актора Apify.
{
  const { toAnnouncement, toStats, mediaOf, toJpeg, cityHashtags, candidatesFrom, createInstagram } = await import('./instagram.mjs');
  const post = {
    shortCode: 'C1x-Ab', url: 'https://www.instagram.com/p/C1x-Ab/', caption: 'Йога на пляже в субботу в 7 утра' + pad, timestamp: '2026-11-20T01:00:00.000Z',
    ownerUsername: 'Anna.Yoga', ownerFullName: 'Anna', likesCount: -1, videoViewCount: 120, displayUrl: 'https://cdn/x.jpg', images: [], videoUrl: 'https://cdn/x.mp4',
  };
  assert.deepEqual(toAnnouncement(post), {
    id: 'C1x-Ab', number: 1795136400, url: post.url, text: post.caption, published_at: '2026-11-20T01:00:00.000Z', author_username: 'anna.yoga', platform: 'instagram',
  });
  assert.deepEqual(toStats(post), { views: 120, reactions: null }, 'скрытые лайки — не ноль');
  assert.deepEqual(mediaOf(post).map((m) => [m.type, m.url]), [['photo', 'https://cdn/x.jpg'], ['video', 'https://cdn/x.mp4']]);
  assert.deepEqual(mediaOf({ ...post, dimensionsWidth: 1080, dimensionsHeight: 1920 }).at(-1), { type: 'video', url: 'https://cdn/x.mp4', number: 0, width: 1080, height: 1920 }, 'размеры ролика — для обложки-ролика на сайте');
  const sharp = (await import('sharp')).default;
  const webp = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#c33' } }).webp().toBuffer();
  const jpeg = await toJpeg(webp);
  assert.deepEqual([jpeg.width, jpeg.height, jpeg.data[0], jpeg.data[1]], [1280, 853, 0xff, 0xd8], 'WebP 3000 px → JPEG 1280 px');
  assert.equal(await toJpeg(Buffer.from('not an image')), null);
  assert.equal(signupUrl({ ...e, instagram_username: 'anna.yoga' }, a, t), 'https://ig.me/m/anna.yoga');
  assert.equal(signupUrl({ ...e, instagram_username: 'anna.yoga', url: 'https://x.co/f' }, a, t), 'https://x.co/f', 'ссылка на регистрацию важнее директа');

  assert.deepEqual(cityHashtags(['Дананг', 'Da Nang']), ['дананг', 'danang', 'danangevents', 'danangparty', 'danangyoga']);
  const now = Date.parse('2026-11-24T00:00:00Z');
  const found = candidatesFrom([
    post, { ...post, shortCode: 'C2' }, { ...post, shortCode: 'C2' }, // одна публикация под двумя хэштегами
    { ...post, shortCode: 'C3', ownerUsername: 'beach_bar', ownerFullName: '', caption: 'закат' },
    { ...post, shortCode: 'C4', ownerUsername: 'old', timestamp: '2026-09-01T00:00:00Z' },
  ], now);
  assert.deepEqual(found.map((c) => [c.channel, c.title, c.posts_30d, c.event_like]), [['instagram:anna.yoga', 'Anna', 2, 2], ['instagram:beach_bar', 'beach_bar', 1, 0]]);

  assert.equal(createInstagram({ token: '' }), null);
  const calls = [];
  const fake = async (url, init) => {
    calls.push(url.replace('https://api.apify.com/v2', ''));
    const body = url.includes('/runs?') ? { data: { id: 'r1', status: 'RUNNING' } }
      : url.includes('/actor-runs/') ? { data: { id: 'r1', status: 'SUCCEEDED', defaultDatasetId: 'd1' } }
      : [post, { url: 'https://www.instagram.com/gone/', error: 'not_found' }];
    return new Response(JSON.stringify(body), { status: init?.method === 'POST' ? 201 : 200 });
  };
  const ig = createInstagram({ token: 't', maxUsd: 0.2, fetch: fake });
  const error = console.error;
  console.error = () => {};
  assert.deepEqual(await ig.posts(['anna.yoga', 'gone'], new Date(now), 5), [post], 'ошибки профилей отсеяны');
  console.error = error;
  assert.deepEqual(calls, ['/acts/apify~instagram-scraper/runs?maxItems=10&maxTotalChargeUsd=0.2', '/actor-runs/r1?waitForFinish=60', '/datasets/d1/items?clean=true']);
  console.log('instagram ok');
}

// Товары мастеров: дешёвый отбор, разбор ответа ИИ, мастер поста и запись (store — подделка; запросы — в collector-store.test.ts).
{
  const { looksLikeProduct, pickProducts, makerOf, saveProducts, uploadFirstPhoto } = await import('./products.mjs');
  // Короткие посты в канале мастера (DragonTapDaNang, danang_cheese — настоящие тексты, ноябрь 2026): одного признака хватает.
  const channel1 = { channel: true };
  assert.ok(looksLikeProduct('Готовы пивчики из куриной грудки с ароматными специями 🐔 Цена прежняя 50g- 40k', channel1));
  assert.ok(looksLikeProduct('Курочка готова 🐔 В нашем original соусе 50g - 40k', channel1));
  assert.ok(looksLikeProduct('Друзья, напоминаем о себе! Говядина, курица, лосось и тунец. Всё в наличии! Принимаем заказы, доставляем по Данангу!', channel1));
  assert.ok(looksLikeProduct('Наш домашній Адигейський сир ми готуємо через день. Вартість: 500.000 VND за 1 кг. Як замовити — пишіть', channel1));
  assert.ok(!looksLikeProduct('Готовы куриные колбаски — 40k', {}), 'в группе одного признака мало');
  assert.ok(!looksLikeProduct('Продам платье, надевала 2 раза, цена 300k, самовывоз', channel1), 'перепродажа и в канале не товар');
  const { parseProducts } = await import('@yaswami/extract');
  const melody = '📅 Наличие 21 ноября на 16:00\nМедовик порционно 100гр/55к\nНаполеон 100гр/55к\nТворог 0,5 кг/120к\nКефир 1 л/90к\nЗаказы в лс @melody_cafe';
  const pelmeni = 'Домашние пельмени с говядиной и свининой! Лепим вручную, без добавок. В наличии: 5кг / 250 000 ₫ / кг. Доставка по My An и Son Tra, пишите @DaNang_pelmeshki';
  assert.ok(looksLikeProduct(melody), 'пост «наличие»');
  assert.ok(looksLikeProduct(pelmeni), 'объявление о пельменях');
  assert.ok(!looksLikeProduct('Продам платье, надевала 2 раза, размер S, отдам за 300к, самовывоз Ан Тхыонг'), 'барахолка');
  assert.ok(!looksLikeProduct('Массаж лица и тела, 60 минут — 500к, выезд на дом, запись в лс'), 'услуга');
  assert.ok(!looksLikeProduct('Наличие 55к'), 'слишком коротко');

  // Один пост «наличие» — несколько товаров; не мастер и неразборчивый ответ — ни одного.
  const ai = { is_maker: true, contact: '@Melody_Cafe', products: [
    { title: 'Медовик порционно', description: null, price: '55к', unit: '100 г', category: 'food' },
    { title: 'Наполеон', description: '', price: '55к', unit: '100 г', category: 'food' },
    { title: 'Творог', description: 'домашний', price: '120к', unit: '0,5 кг', category: 'food' },
    { title: '', description: null, price: null, unit: null, category: 'food' }, // без названия — отброшен
    { title: 'Доставка', description: null, price: null, unit: null, category: 'service' }, // чужая категория — отброшен
  ] };
  const parsed = parseProducts('danangmelody/1', 'STOP', JSON.stringify(ai));
  assert.equal(parsed.contact, 'melody_cafe');
  assert.deepEqual(parsed.products.map((p) => [p.title, p.price, p.unit, p.description]), [['Медовик порционно', '55к', '100 г', null], ['Наполеон', '55к', '100 г', null], ['Творог', '120к', '0,5 кг', 'домашний']]);
  assert.deepEqual(parseProducts('x/1', 'STOP', JSON.stringify({ ...ai, is_maker: false })).products, [], 'перепродажа, услуга, событие — пусто');
  {
    const error = console.error;
    console.error = () => {};
    assert.deepEqual(parseProducts('x/1', 'SAFETY', undefined), { contact: null, products: [] });
    assert.deepEqual(parseProducts('x/1', 'STOP', '{"products": [oops'), { contact: null, products: [] });
    console.error = error;
  }

  const now = Date.parse('2026-11-25T10:00:00Z');
  const date = now / 1000 - 3600;
  const user = (id, username) => ({ className: 'User', id: BigInt(id), firstName: 'Ольга', username, bot: false });
  const photo = { className: 'MessageMediaPhoto' };
  const posts = pickProducts('ads_danang', [
    { id: 1, date, message: pelmeni, sender: user(7, 'Olga_Cook') },
    { id: 2, date, message: pelmeni, sender: user(7, 'Olga_Cook') }, // пачка одинаковых объявлений — одно, последнее
    { id: 3, date, message: 'Продам платье, надевала 2 раза, размер S, 300к, доставка', sender: user(8, 'x') },
    { id: 4, date: date - 40 * 86400, message: melody, sender: user(9, 'old') }, // старше срока
    { id: 5, date, message: melody.replace('@melody_cafe', ''), sender: { className: 'User', id: 1n, username: 'ads_bot', bot: true } }, // бот чата
    { id: 6, date, message: melody.replace('Заказы в лс @melody_cafe', 'Пишите в лс'), sender: user(10, 'Anna_Cakes'), groupedId: 77n },
    { id: 7, date, message: '', media: photo, groupedId: 77n },
  ], { now, maxAgeMs: 30 * 86_400_000 });
  assert.deepEqual(posts.map((p) => [p.url, p.author?.username, p.album.map((m) => m.id)]), [
    ['https://t.me/ads_danang/2', 'olga_cook', [2]],
    ['https://t.me/ads_danang/6', 'anna_cakes', [6, 7]],
  ]);
  const group = { channel: 'ads_danang', host_id: null, host_username: null, host_status: null, city_id: 'danang', city: 'Дананг' };
  // Мастер в группе: контакт из текста (ИИ назвал не тот, что в тексте, — берём из текста), иначе автор, иначе сам чат.
  assert.equal(makerOf(group, posts[0], 'danang_pelmeshki'), 'danang_pelmeshki');
  assert.equal(makerOf(group, posts[0], 'hallucinated'), 'danang_pelmeshki');
  assert.equal(makerOf(group, posts[1], null), 'anna_cakes');
  assert.equal(makerOf({ ...group, channel: 'danang_cheese' }, { text: melody.replace('Заказы в лс @melody_cafe', ''), author: null }, null), 'danang_cheese', 'пост канала без контакта — товар канала');
  assert.equal(makerOf({ ...group, channel: '-1001' }, { text: 'без контакта', author: null }, null), null, 'закрытый чат без контакта — некому написать');
  assert.equal(makerOf({ ...group, host_id: 'h1' }, posts[0], null), null, 'у канала мастера Host уже известен');

  const calls = [];
  const hosts = { danang_pelmeshki: undefined, spam_cook: { id: 'h-spam', status: 'rejected' } };
  const store = {
    touchProducts: async ({ text }) => (text === 'повтор' ? 2 : 0),
    hostByUsername: async (u) => hosts[u],
    saveMaker: async (h) => (calls.push(['saveMaker', h]), { id: `h-${h.username}`, status: 'pending' }),
    saveProducts: async (host_id, products, rest) => (calls.push(['saveProducts', host_id, products.map((p) => p.title), rest]), products.map(() => ({ id: 'p', created: true }))),
  };
  // ИИ назвал «Медовик порционно» дважды, по-разному написав: ключ повтора один — строка одна, первая.
  const fromAi = { contact: 'danang_pelmeshki', products: [...parsed.products, { ...parsed.products[0], title: '  медовик   ПОРЦИОННО ' }] };
  const extractProducts = async (id, author, text) => (text.startsWith('Домашние') ? fromAi : { contact: null, products: [] });
  const resolve = async (u) => (u === 'danang_pelmeshki' ? { id: -100123, name: 'Пельмени Дананг' } : null);
  const log = console.log;
  console.log = () => {};
  const result = await saveProducts({ store, extractProducts, resolve, photo: async () => 'https://m/p.jpg', pause: async () => {} }, group, [
    posts[0],
    { ...posts[1], text: 'повтор' }, // этот текст уже разбирали — в ИИ не идёт
    posts[1], // ИИ: не товары
  ]);
  assert.deepEqual(result, { products: 3, hosts: 1 });
  assert.deepEqual(calls, [
    ['saveMaker', { telegram_id: -100123, username: 'danang_pelmeshki', name: 'Пельмени Дананг', city_id: 'danang', offer_url: 'https://t.me/ads_danang/2' }],
    // Несколько товаров одного мастера — одним вызовом.
    ['saveProducts', 'h-danang_pelmeshki', ['Медовик порционно', 'Наполеон', 'Творог'], { announcement: { url: 'https://t.me/ads_danang/2', text: pelmeni }, posted_at: posts[0].posted_at, photo_url: 'https://m/p.jpg' }],
  ]);

  // Канал мастера: товары — его Host без поиска в Telegram; отклонённый мастер товаров не получает.
  calls.length = 0;
  const channel = { channel: 'danangmelody', host_id: 'h-melody', host_username: 'melody_cafe', host_status: 'pending', city_id: 'danang', city: 'Дананг' };
  const always = async () => fromAi;
  await saveProducts({ store, extractProducts: always, resolve: async () => assert.fail('не ищем'), photo: async () => null, pause: async () => {} }, channel, [posts[1]]);
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['saveProducts', 'h-melody']]);
  calls.length = 0;
  await saveProducts({ store, extractProducts: always, resolve, photo: async () => null, pause: async () => {} }, { ...channel, host_status: 'rejected' }, [posts[1]]);
  await saveProducts({ store, extractProducts: async () => ({ contact: 'spam_cook', products: parsed.products }), resolve, photo: async () => null, pause: async () => {} }, group, [{ ...posts[1], text: `${posts[1].text} @spam_cook` }]);
  console.log = log;
  assert.deepEqual(calls, [], 'отклонённый мастер');

  // ИИ перегружен (503) или упёрся в лимит (429) — saveProducts бросает: отметка не сдвинется, пост перечитают.
  for (const status of [503, 429]) {
    const busy = async () => { throw Object.assign(new Error('high demand'), { status }); };
    await assert.rejects(saveProducts({ store, extractProducts: busy, resolve, photo: async () => null, pause: async () => {} }, channel, [posts[1]]), { status });
  }

  // Первое фото поста — в бакет; без бакета или без фото — null.
  const bucket = { put: async (key) => `https://media/${key}` };
  const downloadPhotos = async ([m]) => [{ number: m.id, data: Buffer.from([0xff, 0xd8]), width: 1280, height: 960 }];
  assert.equal(await uploadFirstPhoto({ bucket, downloadPhotos }, posts[1]), 'https://media/products/ads_danang/7_1280x960.jpg');
  assert.equal(await uploadFirstPhoto({ bucket, downloadPhotos }, posts[0]), null, 'в посте нет фото');
  assert.equal(await uploadFirstPhoto({ bucket: null, downloadPhotos }, posts[1]), null);
  console.log('products ok');
}
