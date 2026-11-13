// Фото и видео анонсов — в S3-совместимом бакете с открытым чтением (Cloudflare R2, ADR-0006).
import { AwsClient } from 'aws4fetch';

const env = process.env;

/**
 * Загрузчик в бакет или null, если бакет не задан: тогда медиа анонсов не сохраняем. `put` возвращает открытый адрес файла.
 * ponytail: в базу ложится полный адрес — сменим домен бакета, старые адреса придётся переписать запросом.
 */
export function createBucket() {
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.MEDIA_PUBLIC_URL) return null;
  const aws = new AwsClient({ accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, region: 'auto', service: 's3' });
  return {
    async put(key, data, type) {
      const res = await aws.fetch(`${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`, { method: 'PUT', body: data, headers: { 'content-type': type } });
      if (!res.ok) throw new Error(`бакет ${key}: ${res.status}`);
      return `${env.MEDIA_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
    },
  };
}
