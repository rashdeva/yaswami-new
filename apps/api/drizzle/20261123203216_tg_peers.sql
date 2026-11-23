CREATE TABLE "tg_peers" (
	"account" text NOT NULL,
	"username" text NOT NULL,
	"peer_id" text NOT NULL,
	"access_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tg_peers_account_username_pk" PRIMARY KEY("account","username")
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "disabled_reason" text;