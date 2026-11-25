import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import { createGenerate, isDailyQuota, QuotaExhausted, retryInMs } from './gemini.ts';

// Тексты ошибок — как их отдал Gemini 2026-11-25 (бесплатный уровень, gemini-3.5-flash-lite).
const DAILY = '{"error":{"code":429,"message":"You exceeded your current quota… Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 500, model: gemini-3.5-flash-lite, description: Generate content requests per day limit exceeded on Free Tier.\\nPlease retry in 13h11m58.146563565s."}}';
const MINUTE = '{"error":{"code":429,"message":"Quota exceeded for metric: generate_content_free_tier_requests, description: Generate content requests per minute limit exceeded. Please retry in 41s."}}';
const err = (status: number, message = '') => Object.assign(new Error(message), { status });
const ok = (text: string) => ({ text }) as GenerateContentResponse;
const params = (model: string): GenerateContentParameters => ({ model, contents: 'x' });

test('лимит: дневной отличаем от минутного, срок сброса — из текста', () => {
  assert.ok(isDailyQuota(err(429, DAILY)));
  assert.ok(!isDailyQuota(err(429, MINUTE)));
  assert.ok(!isDailyQuota(err(503, 'per day')));
  assert.equal(retryInMs(DAILY), ((13 * 60 + 11) * 60 + 58.146563565) * 1000);
  assert.equal(retryInMs(MINUTE), 41_000);
  assert.equal(retryInMs('нет срока'), 3_600_000);
});

test('дневной лимит основной модели — запрос уходит на запасную, основную до сброса не зовём', async () => {
  let clock = 0;
  const calls: string[] = [];
  const spent = new Set(['main']);
  const warn = console.warn;
  console.warn = () => {};
  const generate = createGenerate({
    call: async ({ model }) => {
      calls.push(model);
      if (spent.has(model)) throw err(429, DAILY);
      return ok(model);
    },
    fallback: ['spare', 'last'],
    now: () => clock,
    wait: async () => assert.fail('дневной лимит не ждём'),
  });
  assert.equal((await generate(params('main'))).text, 'spare');
  assert.equal((await generate(params('main'))).text, 'spare');
  assert.deepEqual(calls, ['main', 'spare', 'spare'], 'исчерпанную основную второй раз не зовём');

  // Кончился лимит у всех — ошибка сразу, со сроком самого раннего сброса.
  spent.add('spare').add('last');
  calls.length = 0;
  await assert.rejects(generate(params('main')), (e: unknown) => e instanceof QuotaExhausted && e.status === 429 && e.name === 'QuotaExhausted');
  assert.deepEqual(calls, ['spare', 'last']);
  calls.length = 0;
  await assert.rejects(generate(params('main')), QuotaExhausted);
  assert.deepEqual(calls, [], 'пока лимит не сброшен, Gemini не зовём совсем');

  // После сброса основная снова первая.
  spent.clear();
  clock = 14 * 3_600_000;
  assert.equal((await generate(params('main'))).text, 'main');
  console.warn = warn;
});

test('минутный лимит и перегрузка: одна повторная попытка; перегрузка после повтора — следующая модель', async () => {
  const waits: number[] = [];
  const failures = new Map([['main', [err(429, MINUTE)]]]);
  const generate = createGenerate({
    call: async ({ model }) => {
      const e = failures.get(model)?.shift();
      if (e) throw e;
      return ok(model);
    },
    fallback: ['spare'],
    wait: async (ms) => waits.push(ms),
  });
  assert.equal((await generate(params('main'))).text, 'main');
  assert.deepEqual(waits, [60_000]);

  failures.set('main', [err(503), err(503)]);
  assert.equal((await generate(params('main'))).text, 'spare');
  assert.deepEqual(waits, [60_000, 10_000]);

  // Перегружены все — бросаем перегрузку: это не лимит, следующий проход повторит.
  failures.set('main', [err(503), err(503)]).set('spare', [err(503), err(503)]);
  await assert.rejects(generate(params('main')), (e: { status?: number }) => e.status === 503);

  // Прочие ошибки (битый запрос) — сразу наверх, без запасной модели.
  failures.set('main', [err(400, 'bad request')]);
  await assert.rejects(generate(params('main')), (e: { status?: number }) => e.status === 400);
});
