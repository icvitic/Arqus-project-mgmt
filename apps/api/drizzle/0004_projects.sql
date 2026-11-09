ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_uq" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"country" text NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"identifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"non_profit" boolean DEFAULT false NOT NULL,
	"is_self" boolean DEFAULT false NOT NULL,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organisations_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "project_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"role" text DEFAULT 'partner' NOT NULL,
	"beneficiary_type" text DEFAULT 'default' NOT NULL,
	"order_no" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"acronym" text NOT NULL,
	"title" text NOT NULL,
	"package_row_id" uuid NOT NULL,
	"package_id" text NOT NULL,
	"package_version" text NOT NULL,
	"action_type" text NOT NULL,
	"role" text DEFAULT 'coordinator' NOT NULL,
	"status" text DEFAULT 'contracting' NOT NULL,
	"contract_no" text,
	"start_date" date,
	"duration_months" integer,
	"manager_user_id" uuid,
	"source_proposal_id" uuid,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "projects_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "reporting_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"due_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_partners" ADD CONSTRAINT "project_partners_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_partners" ADD CONSTRAINT "project_partners_org_fk" FOREIGN KEY ("tenant_id","organisation_id") REFERENCES "public"."organisations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_package_row_id_programme_packages_id_fk" FOREIGN KEY ("package_row_id") REFERENCES "public"."programme_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_fk" FOREIGN KEY ("tenant_id","manager_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_periods" ADD CONSTRAINT "reporting_periods_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_self_uq" ON "organisations" USING btree ("tenant_id") WHERE is_self;--> statement-breakpoint
CREATE INDEX "organisations_name_idx" ON "organisations" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "project_partners_uq" ON "project_partners" USING btree ("project_id","organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_contract_uq" ON "projects" USING btree ("tenant_id","contract_no") WHERE contract_no is not null;--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_periods_uq" ON "reporting_periods" USING btree ("project_id","number");
