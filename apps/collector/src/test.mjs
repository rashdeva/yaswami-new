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

const { channelFromBio, fetchChannelPhotos, pickThumb } = await import('./host.mjs');
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
