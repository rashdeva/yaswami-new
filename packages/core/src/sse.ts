// Разбор потока Server-Sent Events: им отвечают Hermes (`stream: true`) и наш `GET /admin/live`. Сети здесь нет —
// функция читает уже открытый поток, поэтому одна и та же работает в API и в админке.

export interface SseEvent { event: string; data: string }

/**
 * События потока по одному; комментарии (`: keepalive`) пропускаются. Поток кончился — генератор тоже;
 * читатель бросил генератор на середине (`return()`, `break`) — поток закрывается.
 */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length) yield { event, data: data.join('\n') };
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}
