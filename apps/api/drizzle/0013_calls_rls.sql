GRANT SELECT, INSERT, UPDATE, DELETE ON calls, call_tracking TO arqus_app;
--> statement-breakpoint
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE calls FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Globalni pozivi (tenant_id NULL) vidljivi svima, mijenja ih samo vlasnik (uvoz); vlastiti samo stanar.
CREATE POLICY calls_select ON calls FOR SELECT USING (tenant_id IS NULL OR tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY calls_modify ON calls FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE call_tracking ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE call_tracking FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY call_tracking_tenant ON call_tracking USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
