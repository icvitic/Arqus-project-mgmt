GRANT SELECT, INSERT, UPDATE ON sessions TO arqus_app;
--> statement-breakpoint
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sessions_tenant ON sessions USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
