// Разовый вход юзербота: npm run login. Запускает человек — код и пароль вводятся только в его терминале.
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

const line = `TG_SESSION=${client.session.save()}`;
const env = await readFile('.env', 'utf8').catch(() => '');
await writeFile('.env', /^TG_SESSION=.*$/m.test(env) ? env.replace(/^TG_SESSION=.*$/m, line) : `${env.trimEnd()}\n${line}\n`);
console.log('Готово: TG_SESSION записан в .env. Эта строка даёт полный доступ к аккаунту — не показывай её никому.');
await client.disconnect();
process.exit(0);
