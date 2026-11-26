// Недельное расписание клуба: одна публикация — 12 занятий, по два в одно время в студиях А и Б у одного контакта.
// Текст — пост 636 группы @yogaclubdanang (22.11.2026), как его прочёл юзербот.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { CollectedEvent } from '@yaswami/core';
import { isSameEvent, pairEvents } from './dedupe.ts';
import { looksLikeEvent } from './prefilter.ts';

const POST = readFileSync(new URL('./fixtures/yogaclub-636.txt', import.meta.url), 'utf8');
const CLUB = 'yoga_club_da_nang';

/** Занятия поста так, как их должен вернуть ИИ: по дню, студии, времени, преподавателю и направлению. */
function classes(text: string): CollectedEvent[] {
  const out: CollectedEvent[] = [];
  let day = '';
  let studio = '';
  for (const line of text.split('\n').map((l) => l.trim())) {
    const d = line.match(/^(\d{1,2}) ноября/);
    if (d?.[1]) day = d[1].padStart(2, '0');
    if (/^Студия [АБ]$/.test(line)) studio = line;
    const [, from, to, teacher, kind] = line.match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2}) (\S+) - (.+)$/) ?? [];
    if (!from || !to || !teacher || !kind) continue;
    const at = (t: string) => `2026-11-${day}T${t.padStart(5, '0')}:00+07:00`;
    out.push({
      title: `${kind} — ${teacher}`, description: '', starts_at: at(from), ends_at: at(to), place: studio, address: null,
      price: null, tags: [/hatha/i.test(kind) ? 'хатха' : 'йога'], telegram_username: CLUB, whatsapp_phone: null, url: null, topic: 'йога',
    });
  }
  return out;
}

test('пост-расписание проходит предфильтр и содержит 12 занятий', () => {
  assert.ok(looksLikeEvent(POST));
  const events = classes(POST);
  assert.equal(events.length, 12);
  assert.deepEqual(events.filter((e) => e.starts_at.startsWith('2026-11-23')).map((e) => [e.place, e.title]),
    [['Студия А', 'YOGA Hatha — Татьяна'], ['Студия Б', 'YOGA FYSM — Константин']]);
});

test('занятия одного расписания друг с другом не склеиваются', () => {
  const events = classes(POST);
  const [hatha, fysm] = events;
  assert.ok(hatha && fysm && isSameEvent(hatha, fysm), 'по эвристике это «одно событие»: тот же день, время и контакт');
  // Первый разбор: всё новое. Ранее записанные занятия этой же публикации (повторный разбор) — каждое на своём месте.
  assert.deepEqual(pairEvents(events, []), events.map(() => undefined));
  const saved = events.map((event, i) => ({ event, external_id: `telegram:yogaclubdanang/636#${i}` }));
  const own = (k: { external_id: string }) => Number(k.external_id.split('#')[1]);
  assert.deepEqual(pairEvents(events, saved, own).map((k) => k?.external_id), saved.map((k) => k.external_id));
});

test('перепост из агрегатора склеивается занятие с занятием', () => {
  const events = classes(POST);
  const [first] = events;
  assert.ok(first);
  const repost = (title: string, tag: string) => ({
    external_id: `telegram:danang_tysa/82394#${tag}`,
    event: { ...first, title, tags: [tag], place: 'YOGA Club Da Nang', telegram_username: 'Yoga_Club_Da_Nang' },
  });
  // Перепост в обратном порядке: подбор идёт по похожести, а не по тому, кто первый.
  const known = [repost('Йога FYSM с Константином', 'fysm'), repost('Хатха-йога с Татьяной', 'хатха')];
  const pairs = pairEvents(events, known);
  assert.equal(pairs[0]?.external_id, 'telegram:danang_tysa/82394#хатха', 'хатха к хатхе');
  assert.equal(pairs[1]?.external_id, 'telegram:danang_tysa/82394#fysm', 'FYSM к FYSM');
  assert.equal(pairs.filter(Boolean).length, 2, 'остальные занятия — новые события');
});
