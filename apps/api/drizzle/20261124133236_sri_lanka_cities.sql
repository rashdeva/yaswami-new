-- Города Шри-Ланки, один раз: дальше список ведёт команда в «Городах» и через MCP (admin_cities_*), этот файл не правят.
-- Центры — приблизительно, по картам; соседи в 25 км друг от друга видят события друг друга. Новому городу сборщик
-- сам ищет источники в первый же проход.
INSERT INTO "cities" ("id", "name", "timezone", "aliases", "latitude", "longitude") VALUES
  ('colombo', 'Коломбо', 'Asia/Colombo', '["Colombo"]', 6.9271, 79.8612),
  ('negombo', 'Негомбо', 'Asia/Colombo', '["Negombo"]', 7.2083, 79.8358),
  ('hikkaduwa', 'Хиккадува', 'Asia/Colombo', '["Hikkaduwa"]', 6.1395, 80.1063),
  ('galle', 'Галле', 'Asia/Colombo', '["Galle", "Галль"]', 6.0329, 80.2168),
  ('unawatuna', 'Унаватуна', 'Asia/Colombo', '["Unawatuna"]', 6.0097, 80.2496),
  ('ahangama', 'Ахангама', 'Asia/Colombo', '["Ahangama", "Midigama"]', 5.9733, 80.3622),
  ('weligama', 'Велигама', 'Asia/Colombo', '["Weligama"]', 5.9746, 80.4297),
  ('mirissa', 'Мирисса', 'Asia/Colombo', '["Mirissa"]', 5.9483, 80.4716),
  ('matara', 'Матара', 'Asia/Colombo', '["Matara"]', 5.9549, 80.5550),
  ('hiriketiya', 'Хирикетия', 'Asia/Colombo', '["Hiriketiya", "Dickwella"]', 5.9636, 80.7087),
  ('tangalle', 'Тангалле', 'Asia/Colombo', '["Tangalle"]', 6.0243, 80.7941),
  ('arugam-bay', 'Аругам-Бей', 'Asia/Colombo', '["Arugam Bay", "Arugambay"]', 6.8404, 81.8368),
  ('kandy', 'Канди', 'Asia/Colombo', '["Kandy"]', 7.2906, 80.6337),
  ('ella', 'Элла', 'Asia/Colombo', '["Ella"]', 6.8667, 81.0466)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Дананг — тоже с центром: иначе геолокация его не найдёт.
UPDATE "cities" SET "latitude" = 16.0544, "longitude" = 108.2022 WHERE "id" = 'danang' AND "latitude" IS NULL;
