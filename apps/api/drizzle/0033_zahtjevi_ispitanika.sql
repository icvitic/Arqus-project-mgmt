CREATE TABLE "subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"received_on" date NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"requester_name" text NOT NULL,
	"requester_contact" text,
	"subject_user_id" uuid,
	"description" text,
	"identity_verified_on" date,
	"extension_informed_on" date,
	"extension_reason" text,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"outcome" text,
	"closed_on" date,
	"outcome_note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "subject_requests_kind_ck" CHECK (kind in ('access', 'rectification', 'erasure', 'restriction', 'portability', 'objection', 'other') and channel in ('email', 'post', 'in_person', 'other')),
	CONSTRAINT "subject_requests_status_ck" CHECK (status in ('open', 'closed') and (status = 'closed') = (closed_on is not null) and (status = 'closed') = (outcome is not null)
    and (outcome is null or outcome in ('fulfilled', 'partly_fulfilled', 'refused', 'withdrawn'))),
	CONSTRAINT "subject_requests_dates_ck" CHECK (due_on > received_on and (closed_on is null or closed_on >= received_on) and (identity_verified_on is null or identity_verified_on >= received_on)
    and (extension_informed_on is null) = (extension_reason is null) and (extension_informed_on is null or extension_informed_on >= received_on))
);
--> statement-breakpoint
ALTER TABLE "subject_requests" ADD CONSTRAINT "subject_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_requests" ADD CONSTRAINT "subject_requests_user_fk" FOREIGN KEY ("tenant_id","subject_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subject_requests_number_uq" ON "subject_requests" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "subject_requests_open_idx" ON "subject_requests" USING btree ("tenant_id","status","due_on");