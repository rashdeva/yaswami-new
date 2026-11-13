-- Сборщик стал брать фото 1280 px и запоминать размеры файлов (по ним вертикальный ролик становится обложкой).
-- Предстоящие события без ключа media сборщик разберёт заново (refresh.mjs) и сохранит медиа в новом виде.
UPDATE collected_events
SET announcement = announcement - 'media'
WHERE coalesce(ends_at, starts_at) >= now() AND announcement ? 'media';
