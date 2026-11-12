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

const { toAnnouncement } = await import('./mtproto.mjs');
const msg = { id: 7, message: 'Завтрак в пятницу', date: 1794366000, sender: { className: 'User', username: 'ivan', bot: false } };
assert.deepEqual(toAnnouncement('danangevent', msg), [{
  id: 'danangevent/7', number: 7, url: 'https://t.me/danangevent/7',
  published_at: new Date(1794366000 * 1000).toISOString(), image_url: null, author_username: 'ivan', text: 'Завтрак в пятницу',
}]);
assert.deepEqual(toAnnouncement('x', { ...msg, message: '' }), [], 'сообщение без текста');
assert.equal(toAnnouncement('x', { ...msg, sender: { className: 'Channel', username: 'x' } })[0].author_username, null, 'канал — не автор');
assert.deepEqual(toAnnouncement('x', { ...msg, sender: { bot: true } }), [], 'сообщение бота');
console.log('mtproto ok');
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
  };
  const fail = (errorMessage) => Object.assign(new Error(errorMessage), { errorMessage });
  let handler;
  const sentTo = [];
  const client = {
    session: { save: () => 'SESSION' },
    connect: async () => {},
    sendCode: async () => ({ phoneCodeHash: 'hash' }),
    invoke: async (request) => { throw fail(request.phoneCode === '11111' ? 'SESSION_PASSWORD_NEEDED' : 'PHONE_CODE_INVALID'); },
    signInWithPassword: async (_api, { password }) => { if ((await password()) !== 'верный') throw fail('PASSWORD_HASH_INVALID'); },
    addEventHandler: (fn) => { handler = fn; },
    getDialogs: async () => [],
    sendMessage: async (peer, { message }) => { if (peer === 42) throw fail('PEER_ID_INVALID'); sentTo.push([peer, message]); return { id: 900 }; },
    disconnect: async () => {},
  };
  const sender = createSender({ store, apiId: '1', apiHash: 'h', key, report: async (m) => void reported.push(m), connectClient: () => client, log: () => {} });

  await sender.tick();
  assert.equal(account.status, 'login_code', 'код запрошен');
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
  console.log('sender ok');
}

// Вопросы «куда сходить» в больших чатах: отбор без ИИ.
{
  const { looksLikeLead, pickLeads } = await import('./lead.mjs');
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
    { id: 4, date: at(200), message: 'Куда сходить вечером?', sender: user }, // старое
    { id: 5, date: at(5), message: 'Чем заняться вечером?', sender: { ...user, bot: true } }, // бот
    { id: 6, date: at(4), message: 'Чем заняться вечером?', sender: { className: 'Channel', id: 7n } }, // от имени канала
  ], now);
  assert.deepEqual(leads, [{
    chat: 'danang_chat', message_id: 3, url: 'https://t.me/danang_chat/3',
    author: { id: 42, name: 'Даша К', username: 'dasha_k' },
    text: 'Куда сегодня сходить потанцевать?', context: ['Всем привет', 'Погода огонь'],
  }]);
  console.log('leads ok');
}
