CREATE TABLE "tg_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"phone" text NOT NULL,
	"status" text DEFAULT 'login_requested' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session" text,
	"login" jsonb,
	CONSTRAINT "tg_accounts_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_id_tg_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."tg_accounts"("id") ON DELETE set null ON UPDATE no action;