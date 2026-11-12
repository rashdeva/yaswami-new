// Разовый вход юзербота: npm run login. Запасной аккаунт для разведки: npm run login SCOUT_SESSION. Запускает человек — код и пароль вводятся только в его терминале.
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { connect } from './mtproto.mjs';

const { TG_API_ID, TG_API_HASH } = process.env;
if (!TG_API_ID || !TG_API_HASH) throw new Error('Впиши TG_API_ID и TG_API_HASH в .env (my.telegram.org → API development tools)');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const client = connect({ apiId: TG_API_ID, apiHash: TG_API_HASH });
await client.start({
  phoneNumber: () => rl.question('Телефон в международном формате: '),
  phoneCode: () => rl.question('Код из Telegram: '),
  password: (hint) => rl.question(`Облачный пароль${hint ? ` (подсказка: ${hint})` : ''}: `),
  onError: (e) => { console.error(e.message); return false; },
});
rl.close();

const name = process.argv.slice(2).find((a) => a !== '--') ?? 'TG_SESSION';
const line = `${name}=${client.session.save()}`;
const env = await readFile('.env', 'utf8').catch(() => '');
await writeFile('.env', new RegExp(`^${name}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${name}=.*$`, 'm'), line) : `${env.trimEnd()}\n${line}\n`);
console.log(`Готово: ${name} записан в .env. Эта строка даёт полный доступ к аккаунту — не показывай её никому.`);
await client.disconnect();
process.exit(0);
