// Счётчики «сколько раз за окно» в памяти процесса: лимиты на запросы, сообщения боту, оповещения команде.
// ponytail: память одного процесса — второй экземпляр API считает отдельно; тогда — в базу или на прокси.

/**
 * Счётчик по ключу в фиксированном окне. `hit` отмечает событие и возвращает, какое оно по счёту в текущем окне
 * (1 — первое). Ключей больше `maxKeys` — вычищаются истёкшие, а если и этого мало, самые старые: сбросить всех
 * разом нельзя, иначе наплыв новых ключей обнулял бы лимит каждому.
 */
export function windowCounter<K>(windowMs: number, maxKeys = 10_000) {
  const hits = new Map<K, { since: number; n: number }>();
  return {
    hit(key: K, now = Date.now()): number {
      const hit = hits.get(key);
      if (hit && now - hit.since < windowMs) return ++hit.n;
      hits.delete(key); // заново в конец: порядок Map — от самых старых окон к новым
      if (hits.size >= maxKeys) {
        for (const [k, h] of hits) if (now - h.since >= windowMs) hits.delete(k);
        for (const k of hits.keys()) { if (hits.size < maxKeys) break; hits.delete(k); }
      }
      hits.set(key, { since: now, n: 1 });
      return 1;
    },
    /** Сколько уже было в текущем окне, не отмечая нового. */
    count(key: K, now = Date.now()): number {
      const hit = hits.get(key);
      return hit && now - hit.since < windowMs ? hit.n : 0;
    },
    clear: () => hits.clear(),
  };
}

/**
 * Адрес клиента за прокси Railway. X-Real-IP ставит сам прокси; первый адрес X-Forwarded-For клиент может подделать,
 * поэтому из него берём только последний — его дописал ближайший к нам прокси.
 */
export const clientIp = (header: (name: string) => string | undefined): string =>
  header('x-real-ip')?.trim() || header('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';

/**
 * Результат на `ttlMs` по ключу: страницы для всех (витрина, sitemap) не пересчитываются на каждый запрос.
 * Ключей немного (города), поэтому без вытеснения.
 */
export function cached<K, T>(ttlMs: number, load: (key: K) => Promise<T>) {
  const store = new Map<K, { at: number; value: Promise<T> }>();
  return (key: K): Promise<T> => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = load(key);
    store.set(key, { at: Date.now(), value });
    value.catch(() => store.delete(key)); // ошибку не кэшируем
    return value;
  };
}
