ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT 100000 + ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 13))::bit(52)::bigint % 900000;--> statement-breakpoint
-- 16-значные id из 20261124115558_random_user_ids — на 6-значные. Ссылки по ключам переезжают сами (ON UPDATE cascade),
-- без ключей — ниже. DISTINCT ON и повтор не нужны: новые id 6-значные и со старыми 16-значными не пересекаются,
-- а совпадение двух новых между собой (≈ n²/1,8·10^6, для 17 человек ~0,02%) уронит миграцию целиком — выкладка повторится.
CREATE TEMP TABLE user_id_map ON COMMIT DROP AS
  SELECT id AS old_id, 100000 + ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 13))::bit(52)::bigint % 900000 AS new_id FROM users;--> statement-breakpoint
UPDATE users u SET id = m.new_id FROM user_id_map m WHERE u.id = m.old_id;--> statement-breakpoint
UPDATE admin_actions a SET actor_id = m.new_id FROM user_id_map m WHERE a.actor_id = m.old_id;--> statement-breakpoint
UPDATE admin_actions a SET entity_id = m.new_id::text FROM user_id_map m WHERE a.entity = 'user' AND a.entity_id = m.old_id::text;--> statement-breakpoint
UPDATE messages x SET author = 'admin:' || m.new_id FROM user_id_map m WHERE x.author = 'admin:' || m.old_id;
