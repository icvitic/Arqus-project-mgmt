ALTER TABLE "calls" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_source_ck" CHECK (source in ('manual','ft'));