// Вложения переписки: голосовые, аудио, видео, фото и файлы, которые люди присылают боту или на наши аккаунты.
// Файл кладём в бакет (`inbox/…`, ключ — inboxMediaKey в core), речь расшифровываем: роли Hermes читают переписку
// текстом, и без расшифровки голосовое для них пустое место. Админка показывает плеер и расшифровку.
import { randomUUID } from 'node:crypto';
import type { MessageMedia, MessageMediaInput, MessageMediaType } from '@yaswami/core';
import { hasSpeech, inboxMediaKey, mediaExt } from '@yaswami/core';
import { bucket } from './bucket.ts';
import { settings } from './settings.ts';
import { bot } from './telegram.ts';

/** Bot API отдаёт боту файлы до 20 МБ; больше — только ссылка «не сохранили». */
const BOT_FILE_MAX_BYTES = 20_000_000;
/** Расшифровка длиннее получаса — уже не реплика в переписке, а запись эфира: не тратим на неё запрос. */
const TRANSCRIBE_MAX_SECONDS = 30 * 60;

/** Бесплатный тариф Groq принимает файл до 25 МБ. */
const TRANSCRIBE_MAX_BYTES = 25_000_000;

/**
 * Расшифровка речи — Whisper на Groq (OpenAI-совместимый `/audio/transcriptions`): бесплатный тариф, Gemini не трогаем —
 * его лимит общий со сборщиком анонсов. Groq принимает ogg голосовых и mp4 кружков и видео как есть.
 * Тесты подменяют `transcribe`. null — ключа нет (GROQ_API_KEY) или Groq ошибся. Не бросает.
 */
export const transcriber = {
  async transcribe(data: Buffer, mimeType: string, fileName: string): Promise<string | null> {
    if (!settings.groqKey) return null;
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(data)], { type: mimeType }), fileName);
      form.append('model', settings.transcribeModel);
      form.append('response_format', 'json');
      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST', headers: { authorization: `Bearer ${settings.groqKey}` }, body: form, signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return ((await res.json()) as { text?: string }).text?.trim() ?? null;
    } catch (e) {
      console.error('расшифровка:', e);
      return null;
    }
  },
};

/** Файл во входящем сообщении боту, как его описывает Bot API. */
export interface BotFile {
  type: MessageMediaType;
  file_id: string;
  file_size: number | null;
  mime_type: string | null;
  duration: number | null;
  file_name: string | null;
}

async function speech(media: MessageMediaInput, data: Buffer | null): Promise<string | null> {
  if (!data || !hasSpeech(media.type) || data.length > TRANSCRIBE_MAX_BYTES || (media.duration ?? 0) > TRANSCRIBE_MAX_SECONDS) return null;
  // Кружок и видео Telegram — mp4, голосовое — ogg/opus. Формат Groq определяет по расширению имени файла.
  const mime = media.mime_type ?? (media.type === 'voice' ? 'audio/ogg' : media.type === 'audio' ? 'audio/mpeg' : 'video/mp4');
  return (await transcriber.transcribe(data, mime, `${media.type}.${mediaExt(mime, media.type, media.file_name)}`)) || null;
}

/** Скачать файл у Bot API. null — больше лимита или Telegram не отдал. */
async function botDownload(file: BotFile): Promise<Buffer | null> {
  if ((file.file_size ?? 0) > BOT_FILE_MAX_BYTES) return null;
  const res = await bot.call('getFile', { file_id: file.file_id });
  const path = (res.result as { file_path?: string } | undefined)?.file_path;
  if (!path) return null;
  try {
    const got = await fetch(`https://api.telegram.org/file/bot${bot.token}/${path}`, { signal: AbortSignal.timeout(60_000) });
    return got.ok ? Buffer.from(await got.arrayBuffer()) : null;
  } catch (e) {
    console.error('файл из Telegram:', e);
    return null;
  }
}

/** Вложение сообщения боту: скачать, положить в бакет, расшифровать речь. Не бросает: что не вышло, остаётся null. */
export async function saveBotMedia(file: BotFile, chatId: number): Promise<MessageMedia> {
  const base = { type: file.type, mime_type: file.mime_type, duration: file.duration, file_name: file.file_name };
  const data = await botDownload(file);
  let url: string | null = null;
  const b = bucket();
  if (data && b) {
    url = await b.put(inboxMediaKey('bot', chatId, randomUUID(), mediaExt(file.mime_type, file.type, file.file_name)), data, file.mime_type ?? 'application/octet-stream')
      .catch((e) => (console.error('вложение в бакет:', e), null));
  }
  return { ...base, url, transcript: await speech({ ...base, url }, data) };
}

const fromOurBucket = (url: string) => {
  const base = process.env.MEDIA_PUBLIC_URL?.replace(/\/$/, '');
  return !!base && url.startsWith(`${base}/`);
};

/** Вложения с нашего аккаунта: сборщик уже положил файлы в бакет, расшифровываем по открытому адресу. Не бросает. */
export async function transcribeMedia(media: MessageMediaInput[]): Promise<MessageMedia[]> {
  return Promise.all(media.map(async (m) => {
    let data: Buffer | null = null;
    // Качаем только из своего бакета: адрес приходит от сборщика, и чужой адрес сделал бы API прокси во внутреннюю сеть.
    if (m.url && hasSpeech(m.type) && fromOurBucket(m.url)) {
      data = await fetch(m.url, { signal: AbortSignal.timeout(60_000) })
        .then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null))
        .catch((e) => (console.error('вложение из бакета:', e), null));
    }
    return { ...m, transcript: await speech(m, data) };
  }));
}
