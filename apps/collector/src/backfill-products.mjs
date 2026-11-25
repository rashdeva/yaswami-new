// Товары из истории источников: npm run backfill-products [источник …]. Разовый запуск руками: сборщик сам видит только
// новые сообщения, а этот скрипт проходит назад на SCOUT_DAYS дней (по умолчанию 30 — сколько гость видит товар) по
// источникам вида products или по источникам из аргументов (их ищем среди products, иначе читаем как группу первого города)
// и пишет через тот же saveProducts, что и сборщик. Фото — в бакет, если он задан (S3_*, MEDIA_PUBLIC_URL).
// Отметку источника сдвигает на последнее прочитанное: сборщик не отправит те же посты в ИИ второй раз.
// Сессия — SCOUT_SESSION: сессию сборщика рядом с Railway не открываем.
import { setTimeout as sleep } from 'node:timers/promises';
import { createProductExtractor } from '@yaswami/extract';
import { createBucket } from './bucket.mjs';
import { connect, downloadPhotos } from './mtproto.mjs';
import { resolveAuthor } from './offers.mjs';
import { pickProducts, saveProducts, uploadFirstPhoto } from './products.mjs';
import { createStore } from './store.mjs';

const { TG_API_ID, TG_API_HASH, SCOUT_SESSION, DATABASE_URL, GEMINI_API_KEY } = process.env;
if (!SCOUT_SESSION || !DATABASE_URL || !GEMINI_API_KEY) throw new Error('Нужны SCOUT_SESSION, DATABASE_URL и GEMINI_API_KEY');
const days = Number(process.env.SCOUT_DAYS ?? 30);
const args = process.argv.slice(2).filter((a) => a !== '--').map((a) => a.replace(/^@/, ''));
const store = createStore(DATABASE_URL);
const bucket = createBucket();
if (!bucket) console.log('Фото товаров не сохраняются: нужны S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY и MEDIA_PUBLIC_URL');

const known = await store.productSources();
const [first] = await store.cities();
const sources = args.length
  ? args.map((a) => known.find((s) => s.channel.toLowerCase() === a.toLowerCase()) ?? { channel: a, host_id: null, host_username: null, host_status: null, city_id: first.id, city: first.name })
  : known;
const cursors = await store.cursors();

const client = connect({ apiId: TG_API_ID, apiHash: TG_API_HASH, session: SCOUT_SESSION });
await client.connect();
const extractProducts = createProductExtractor({ model: process.env.EXTRACT_MODEL ?? 'gemini-3.5-flash-lite' });
const pause = () => sleep(Number(process.env.LLM_PAUSE_MS ?? 4500));
const since = Date.now() / 1000 - days * 86400;

let total = 0;
for (const source of sources) {
  const messages = [];
  try {
    for await (const m of client.iterMessages(/^-?\d+$/.test(source.channel) ? Number(source.channel) : source.channel, { limit: 5000, waitTime: 1 })) {
      if (m.date < since) break;
      messages.push(m);
    }
  } catch (e) {
    console.error(`@${source.channel}: ${e.message}`);
    continue;
  }
  messages.reverse();
  const posts = pickProducts(source.channel, messages);
  const { products, hosts } = await saveProducts({
    store, extractProducts, pause, resolve: (u) => resolveAuthor(client, u),
    photo: (post) => uploadFirstPhoto({ bucket, downloadPhotos: (album) => downloadPhotos(client, album) }, post),
  }, source, posts);
  const key = `product:${source.channel}`;
  const last = messages.at(-1)?.id ?? 0;
  if (last > (cursors[key] ?? 0)) await store.saveCursor(key, last);
  total += products;
  console.log(`@${source.channel}: ${messages.length} сообщений, похоже на товары ${posts.length}, записано ${products} у мастеров: ${hosts}`);
  await sleep(1500);
}
console.log(`всего записано товаров: ${total}`);
await client.disconnect();
await store.end();
process.exit(0);
