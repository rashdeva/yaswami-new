// Один путь к Gemini для всех разборов (анонсы, услуги, товары, справки, запросы, темы): повторы и дневной лимит — здесь.
// Бесплатный уровень даёт каждой модели свой дневной лимит запросов (у gemini-3.5-flash-lite — 500), и сборщик выбирал
// его за полдня: дальше каждый вызов ждал минуту и падал с 429 до сброса. Поэтому, когда дневной лимит модели исчерпан,
// запрос уходит на следующую модель из GEMINI_FALLBACK_MODELS, а исчерпанную не трогаем до её сброса.
import { setTimeout as sleep } from 'node:timers/promises';
import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';

/** Запасные модели по порядку, если у основной кончился дневной лимит (или она перегружена). Проверены 2026-11-26. */
export const FALLBACK_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash'];

/**
 * Дневной лимит исчерпан у всех моделей: до сброса повторять бесполезно. `status` 429 — для тех, кто уже узнаёт лимит
 * по статусу (сборщик не сдвигает отметку источника и перечитает его в следующий проход).
 */
export class QuotaExhausted extends Error {
  readonly status = 429;
  readonly until: Date;
  constructor(until: Date) {
    super(`дневной лимит Gemini исчерпан у всех моделей до ${until.toISOString()}`);
    this.name = 'QuotaExhausted';
    this.until = until;
  }
}

interface ApiError { status?: number; message?: string }

/** 429 из-за дневного лимита, а не минутного: «Generate content requests per day limit exceeded», quotaId …PerDay…. */
export const isDailyQuota = (e: ApiError) => e.status === 429 && /per\s?day/i.test(e.message ?? '');

/** Через сколько лимит сбросится — из «Please retry in 13h11m58.1s»; не сказано — через час. */
export function retryInMs(message = '') {
  const m = /retry in ((\d+)h)?((\d+)m)?(([\d.]+)s)?/i.exec(message);
  const ms = m ? ((Number(m[2] ?? 0) * 60 + Number(m[4] ?? 0)) * 60 + Number(m[6] ?? 0)) * 1000 : 0;
  return ms > 0 ? ms : 3_600_000;
}

type Call = (params: GenerateContentParameters) => Promise<GenerateContentResponse>;

/**
 * `generate(params)` — generateContent с основной моделью `params.model` и запасными `fallback`. Минутный лимит (429)
 * и перегрузка (503) проходят сами: одна повторная попытка через `wait`. Дневной лимит — модель откладывается до сброса,
 * запрос уходит на следующую; если отложены все — QuotaExhausted сразу, без ожидания. Прочие ошибки бросает как есть.
 */
export function createGenerate({ call, fallback = FALLBACK_MODELS, now = Date.now, wait = (ms: number) => sleep(ms) }: { call: Call; fallback?: string[]; now?: () => number; wait?: (ms: number) => Promise<unknown> }) {
  const exhausted = new Map<string, number>(); // модель → до какого времени её не зовём
  const once = (params: GenerateContentParameters) => call(params).catch(async (e: ApiError) => {
    if (isDailyQuota(e) || (e.status !== 429 && e.status !== 503)) throw e;
    await wait(e.status === 429 ? 60_000 : 10_000);
    return call(params);
  });
  return async function generate(params: GenerateContentParameters): Promise<GenerateContentResponse> {
    const models = [params.model, ...fallback.filter((m) => m !== params.model)];
    let overloaded: unknown;
    for (const model of models) {
      if ((exhausted.get(model) ?? 0) > now()) continue;
      try {
        return await once({ ...params, model });
      } catch (e) {
        const err = e as ApiError;
        if (isDailyQuota(err)) {
          exhausted.set(model, now() + retryInMs(err.message));
          console.warn(`Gemini: дневной лимит ${model} исчерпан до ${new Date(exhausted.get(model)!).toISOString()}, дальше — запасная модель`);
          continue;
        }
        // Перегрузка и после повтора: пробуем следующую модель, а не ждём эту.
        if (err.status === 503) {
          overloaded ??= e;
          continue;
        }
        throw e;
      }
    }
    if (overloaded) throw overloaded;
    throw new QuotaExhausted(new Date(Math.min(...models.map((m) => exhausted.get(m) ?? now()))));
  };
}

let shared: ReturnType<typeof createGenerate> | undefined;
/**
 * Общий на процесс вызов: отложенные модели видят все разборы сразу. Запасные — GEMINI_FALLBACK_MODELS через запятую
 * (пусто — без запасных), иначе FALLBACK_MODELS.
 */
export function gemini() {
  if (!shared) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const env = process.env.GEMINI_FALLBACK_MODELS;
    shared = createGenerate({ call: (params) => ai.models.generateContent(params), fallback: env === undefined ? FALLBACK_MODELS : env.split(',').map((m) => m.trim()).filter(Boolean) });
  }
  return shared;
}
