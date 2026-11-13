-- Медиа анонсов переехали с временного адреса r2.dev на свой домен бакета (ADR-0006): переписываем сохранённые адреса.
UPDATE collected_events
SET announcement = replace(announcement::text, 'https://pub-2c0da53934274697ab447c6048374aec.r2.dev/', 'https://media.yaswami.com/')::jsonb
WHERE announcement::text LIKE '%pub-2c0da53934274697ab447c6048374aec.r2.dev%';
