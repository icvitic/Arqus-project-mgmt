CREATE TABLE "proposal_collaborators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"access" text DEFAULT 'edit' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "proposal_collaborators_access_ck" CHECK (access in ('edit', 'read'))
);
--> statement-breakpoint
ALTER TABLE "proposal_collaborators" ADD CONSTRAINT "proposal_collaborators_proposal_fk" FOREIGN KEY ("tenant_id","proposal_id") REFERENCES "public"."proposals"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_collaborators" ADD CONSTRAINT "proposal_collaborators_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_collaborators_uq" ON "proposal_collaborators" USING btree ("proposal_id","user_id");--> statement-breakpoint
CREATE INDEX "proposal_collaborators_user_idx" ON "proposal_collaborators" USING btree ("tenant_id","user_id");