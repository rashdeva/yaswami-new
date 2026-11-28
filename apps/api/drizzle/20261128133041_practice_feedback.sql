CREATE TABLE "practice_feedback" (
	"practice_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"via" text NOT NULL,
	"attended" boolean,
	"rating" integer,
	"comment" text,
	"source_url" text,
	"verified_at" timestamp with time zone,
	"prompt_message_id" integer,
	"host_notified_at" timestamp with time zone,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_feedback_practice_id_user_id_pk" PRIMARY KEY("practice_id","user_id"),
	CONSTRAINT "practice_feedback_rating_check" CHECK ("practice_feedback"."rating" between 1 and 5),
	CONSTRAINT "practice_feedback_via_check" CHECK ("practice_feedback"."via" in ('signup', 'invite'))
);
--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "feedback_bonus" text;--> statement-breakpoint
ALTER TABLE "practice_feedback" ADD CONSTRAINT "practice_feedback_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_feedback" ADD CONSTRAINT "practice_feedback_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_feedback" ADD CONSTRAINT "practice_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "practice_feedback_host_idx" ON "practice_feedback" USING btree ("host_id");