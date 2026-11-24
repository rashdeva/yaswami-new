ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "collected_event_signups" DROP CONSTRAINT "collected_event_signups_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_host_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "event_feedback" DROP CONSTRAINT "event_feedback_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "guests" DROP CONSTRAINT "guests_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "hosts" DROP CONSTRAINT "hosts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "photos" DROP CONSTRAINT "photos_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "practice_signups" DROP CONSTRAINT "practice_signups_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_identities" DROP CONSTRAINT "user_identities_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT "visits_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT "visits_referrer_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT 1000000000000000 + ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 13))::bit(52)::bigint;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "collected_event_signups" ADD CONSTRAINT "collected_event_signups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "event_feedback" ADD CONSTRAINT "event_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "practice_signups" ADD CONSTRAINT "practice_signups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
DROP SEQUENCE "public"."users_local_id_seq";--> statement-breakpoint
-- Старые id (Telegram id у пользователей до ADR-0008, -1, -2, … после) меняются на случайные из того же выражения,
-- что и default users.id. Ссылки по внешним ключам переезжают сами (ON UPDATE cascade); без ключей — ниже руками.
CREATE TEMP TABLE user_id_map ON COMMIT DROP AS
  SELECT id AS old_id, 1000000000000000 + ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 13))::bit(52)::bigint AS new_id FROM users;--> statement-breakpoint
UPDATE users u SET id = m.new_id FROM user_id_map m WHERE u.id = m.old_id;--> statement-breakpoint
UPDATE admin_actions a SET actor_id = m.new_id FROM user_id_map m WHERE a.actor_id = m.old_id;--> statement-breakpoint
UPDATE admin_actions a SET entity_id = m.new_id::text FROM user_id_map m WHERE a.entity = 'user' AND a.entity_id = m.old_id::text;--> statement-breakpoint
UPDATE messages x SET author = 'admin:' || m.new_id FROM user_id_map m WHERE x.author = 'admin:' || m.old_id;
