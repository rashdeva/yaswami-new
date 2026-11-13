CREATE TABLE "practice_signups" (
	"host_id" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_signups_host_id_user_id_title_pk" PRIMARY KEY("host_id","user_id","title")
);
--> statement-breakpoint
ALTER TABLE "practice_signups" ADD CONSTRAINT "practice_signups_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_signups" ADD CONSTRAINT "practice_signups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practice_signups_user_idx" ON "practice_signups" USING btree ("user_id");