// Бакет Cloudflare R2 с открытым чтением (ADR-0006, ADR-0011): туда API кладёт обложки. Тот же бакет и те же
// переменные окружения, что у сборщика (`apps/collector/src/bucket.mjs`).
import { AwsClient } from 'aws4fetch';

export interface Bucket {
  /** Кладёт файл и возвращает его открытый адрес. */
  put(key: string, data: Buffer, type: string): Promise<string>;
}

function fromEnv(env = process.env): Bucket | null {
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.MEDIA_PUBLIC_URL) return null;
  const aws = new AwsClient({ accessKeyId: env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '', region: 'auto', service: 's3' });
  const base = env.MEDIA_PUBLIC_URL.replace(/\/$/, '');
  return {
    async put(key, data, type) {
      const res = await aws.fetch(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`, {
        method: 'PUT', body: new Uint8Array(data),
        // Ключ содержит хэш содержимого: файл по адресу не меняется, кэш навсегда.
        headers: { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' },
      });
      if (!res.ok) throw new Error(`бакет ${key}: ${res.status}`);
      return `${base}/${key}`;
    },
  };
}

let current: Bucket | null = fromEnv();

/** Бакет или null, если переменные `S3_*` и `MEDIA_PUBLIC_URL` не заданы: тогда обложки хранятся в Postgres, как раньше. */
export const bucket = (): Bucket | null => current;

/** Подменить бакет (тесты). */
export const setBucket = (b: Bucket | null): void => { current = b; };
