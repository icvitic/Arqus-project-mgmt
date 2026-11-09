-- Aplikacijska uloga bez BYPASSRLS; migracije se izvode pod vlasničkom ulogom.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arqus_app') THEN
    CREATE ROLE arqus_app LOGIN PASSWORD 'arqus' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO arqus_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants, users, roles, role_assignments TO arqus_app;
--> statement-breakpoint
-- Revizijski zapis: samo dodavanje i čitanje (invarijanta: nepromjenjiv).
GRANT SELECT, INSERT ON audit_entries TO arqus_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE audit_entries_id_seq TO arqus_app;
--> statement-breakpoint
-- Pomoćna funkcija: trenutačni stanar iz postavke transakcije (NULL ako nije postavljen).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Stanar: vlastiti redak; bez konteksta (prijava) smije se čitati samo id/slug kroz policy za SELECT.
CREATE POLICY tenants_select ON tenants FOR SELECT USING (app_current_tenant() IS NULL OR id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY tenants_update ON tenants FOR UPDATE USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_tenant ON users USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Sistemske uloge (tenant_id NULL) vidljive svima, mijenja ih samo vlasnik; stanarske samo vlastiti stanar.
CREATE POLICY roles_select ON roles FOR SELECT USING (tenant_id IS NULL OR tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY roles_modify ON roles FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_assignments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY role_assignments_tenant ON role_assignments USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE audit_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_tenant ON audit_entries USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
