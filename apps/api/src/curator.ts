// Куратор витрины (ADR-0009): раз в день, в settings.curatorHour по часам города, просим роль curator собрать витрину
// этого города. Правит роль сама — инструментами полок со своим токеном (shelves.ts держит её в границах); здесь только
// расписание и задание. Отчёт роли — в лог; сами правки — в журнале команды.
import type { City } from '@yaswami/core';
import { cityNow } from '@yaswami/core';
import type { Db } from './db/client.ts';
import { listCities } from './services.ts';
import { settings } from './settings.ts';
import { curator } from './support.ts';

/** Задание роли: город, его дата и режим витрины. Названия городов пишет команда — это не текст посторонних. */
export const curatorTask = (city: City, day: string) =>
  `Собери витрину города ${city.name} (city_id: ${city.id}) на ${day}. Режим витрины: ${city.showcase_mode}${city.showcase_mode === 'draft' ? ' — твои новые полки станут предложенными, их опубликует команда' : ' — публикуешь сам'}.`;

// Город → день, за который витрину уже собрали в этом процессе; `running` — задание ушло роли, ответа ещё нет
// (сборка идёт минуты, а проход — раз в 10 минут). Роль не ответила — день не засчитан: следующий проход в тот же час
// спросит снова. ponytail: в памяти процесса — перезапуск в час куратора соберёт витрину ещё раз; это безопасно
// (сервер ограничивает правки куратора в сутки), но лишний вызов модели.
const done = new Map<string, string>();
const running = new Set<string>();

/** Один проход: каждому городу, у которого сейчас час куратора и сегодня ещё не собирали, — задание роли. */
export async function requestCuration(db: Db, now = Date.now()): Promise<string[]> {
  if (!settings.curatorUrl) return [];
  const asked: string[] = [];
  for (const city of await listCities(db)) {
    const { day, minutes } = cityNow(city.timezone, now);
    if (Math.floor(minutes / 60) !== settings.curatorHour || done.get(city.id) === day || running.has(city.id)) continue;
    running.add(city.id);
    asked.push(city.id);
    try {
      const report = await curator.ask(curatorTask(city, day));
      if (report !== null) done.set(city.id, day);
      console.log(`[curator] ${city.id} ${day}: ${report ?? 'роль недоступна, спросим на следующем проходе'}`);
    } finally {
      running.delete(city.id);
    }
  }
  return asked;
}

/** Проверяем раз в 10 минут: час куратора у каждого города свой, по его часовому поясу. */
export function startCuratorLoop(db: Db, everyMs = 10 * 60_000): void {
  const tick = () => requestCuration(db).catch(console.error);
  setInterval(tick, everyMs);
  void tick();
}
