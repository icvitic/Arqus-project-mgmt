CREATE TABLE "programme_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"package_id" text NOT NULL,
	"version" text NOT NULL,
	"programme" text NOT NULL,
	"funder" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"extends_id" text,
	"valid_from" text NOT NULL,
	"valid_to" text,
	"content" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "programme_packages" ADD CONSTRAINT "programme_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "programme_packages_tenant_uq" ON "programme_packages" USING btree ("tenant_id","package_id","version") WHERE tenant_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "programme_packages_global_uq" ON "programme_packages" USING btree ("package_id","version") WHERE tenant_id is null;--> statement-breakpoint
CREATE INDEX "programme_packages_lookup_idx" ON "programme_packages" USING btree ("package_id","status");