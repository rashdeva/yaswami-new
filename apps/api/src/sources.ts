// Источник, который предлагает человек (sources_add): кнопка внизу главной в приложении и на сайте или просьба
// в переписке с ботом (роль support, person_sources_add). Источник ждёт решения команды выключенным
// (`approval_status: pending_approval`) — сборщик читает только включённые; решает команда в «Источниках»
// (admin_sources_update, admin/sources.ts), там же видно, кто предложил.
import { and, eq, gt, sql } from 'drizzle-orm';
import type { SourceAddInput, SourceSubmission, User } from '@yaswami/core';
import { SOURCES_PER_DAY, instagramOf, submittedChannel } from '@yaswami/core';
import { telegramIdOf } from './auth.ts';
import type { Db } from './db/client.ts';
import { sources } from './db/schema.ts';
import { alertTeam } from './inbox.ts';
import { AppError, assertCity, sameChannel } from './services.ts';
import { settings } from './settings.ts';
import { bot } from './telegram.ts';

const DAY = 86_400_000;

/**
 * Канал Telegram, который предлагают, должен быть публичным каналом: группа, чат и чужой профиль — не источник анонсов.
 * Bot API отвечает о любом публичном чате по @username. Telegram недоступен (или у API нет токена бота) — пропускаем:
 * всё равно решает команда.
 */
async function assertPublicChannel(channel: string): Promise<void> {
  const res = await bot.call('getChat', { chat_id: `@${channel}` });
  if (res.ok) {
    const type = (res.result as { type?: string } | undefined)?.type;
    if (type && type !== 'channel') throw new AppError('not_a_channel', 400);
    return;
  }
  if (res.error_code === 400) throw new AppError('channel_not_found', 404); // «chat not found»: нет такого или это человек
}

/**
 * Предложить источник. Защита от спама: не больше SOURCES_PER_DAY предложений человека за сутки (считаются и
 * одобренные, и отклонённые), канал Telegram проверяется в Telegram (только публичный канал), уже известный источник —
 * включённый, выключенный, предложенный кем-то или отклонённый — второй раз не записывается.
 */
export async function addSource(db: Db, actor: User, input: SourceAddInput): Promise<SourceSubmission> {
  const channel = submittedChannel(input.channel);
  const [today] = await db.select({ n: sql<number>`count(*)::int` }).from(sources)
    .where(and(eq(sources.submitted_by, actor.id), gt(sources.created_at, new Date(Date.now() - DAY))));
  if (today!.n >= SOURCES_PER_DAY) throw new AppError('sources_limit', 429);
  if ((await db.select({ channel: sources.channel }).from(sources).where(sameChannel(channel))).length) throw new AppError('source_exists', 409);
  const city_id = input.city_id ?? actor.city_id ?? settings.defaultCityId;
  await assertCity(db, city_id);
  if (!instagramOf(channel)) await assertPublicChannel(channel);
  const added = await db.insert(sources)
    .values({ channel, city_id, kind: 'announcements', enabled: false, approval_status: 'pending_approval', submitted_by: actor.id })
    .onConflictDoNothing().returning();
  if (!added.length) throw new AppError('source_exists', 409);
  // Команде — сразу, с тем, кто предложил: решение ждёт её в «Источниках». Ждём отправки, чтобы порядок сообщений был
  // предсказуем; сбой оповещения заявку не отменяет.
  const ig = instagramOf(channel);
  const who = `${actor.first_name}${actor.username ? ` (@${actor.username})` : ''}`;
  const link = ig ? `instagram.com/${ig}` : `t.me/${channel}`;
  await alertTeam(`${who} предлагает источник: ${link}\n${settings.publicUrl}/admin/sources`, await telegramIdOf(db, actor.id)).catch(console.error);
  return { channel, city_id, approval_status: 'pending_approval' };
}
