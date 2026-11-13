-- Единый поиск (search в services.ts): word_similarity находит название с опечаткой («масаж» → «массаж»).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
