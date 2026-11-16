CREATE TABLE "call_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"fit_scores" jsonb,
	"fit_total" integer,
	"fit_comment" text,
	"assessed_by" uuid,
	"assessed_at" timestamp with time zone,
	"decision" text,
	"rationale" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"internal_deadline" date,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "call_tracking_fit_ck" CHECK (fit_total is null or fit_total between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"programme" text NOT NULL,
	"funder" text,
	"package_id" text,
	"action_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"budget_cents" bigint,
	"expected_grants" integer,
	"opens_at" date,
	"deadlines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"url" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "call_tracking" ADD CONSTRAINT "call_tracking_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_tracking" ADD CONSTRAINT "call_tracking_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_tracking" ADD CONSTRAINT "call_tracking_owner_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_tracking_uq" ON "call_tracking" USING btree ("tenant_id","call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_tenant_code_uq" ON "calls" USING btree ("tenant_id","code") WHERE tenant_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "calls_global_code_uq" ON "calls" USING btree ("code") WHERE tenant_id is null;