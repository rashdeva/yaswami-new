// npm run chats — каналы и группы аккаунта юзербота с их id (нужны для закрытых каналов в CHANNELS).
import { connect } from './mtproto.mjs';

const { TG_API_ID, TG_API_HASH, TG_SESSION } = process.env;
if (!TG_SESSION) throw new Error('TG_SESSION пуст: выполни npm run login');
const client = connect({ apiId: TG_API_ID, apiHash: TG_API_HASH, session: TG_SESSION });
await client.connect();
for (const d of await client.getDialogs({})) {
  if (d.isChannel || d.isGroup) console.log(`${d.id}\t${d.entity?.username ? `@${d.entity.username}` : 'закрытый'}\t${d.title}`);
}
await client.disconnect();
process.exit(0);
