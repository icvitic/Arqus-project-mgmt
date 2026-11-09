GRANT SELECT, INSERT, UPDATE, DELETE ON programme_packages TO arqus_app;
--> statement-breakpoint
ALTER TABLE programme_packages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE programme_packages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Globalni paketi (tenant_id NULL) vidljivi svim stanarima, mijenja ih samo vlasnik (uvoz); stanarski samo vlastiti stanar.
CREATE POLICY programme_packages_select ON programme_packages FOR SELECT USING (tenant_id IS NULL OR tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY programme_packages_modify ON programme_packages FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
