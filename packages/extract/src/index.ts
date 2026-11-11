// Извлечение событий из текста публикации. Один механизм на двоих: сборщик каналов (apps/collector)
// и бот, которому анонс прислали сообщением (apps/api/src/bot.ts).
export * from './extract.ts';
export * from './prefilter.ts';
export * from './dedupe.ts';
export * from './host.ts';
