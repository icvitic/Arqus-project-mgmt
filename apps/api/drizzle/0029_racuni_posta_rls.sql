-- WP1.21: tokeni računa (pozivnica, nova lozinka), zapis isporuke e-pošte i dnevni sažetak.
-- Tokeni računa: aplikacija ih stvara i briše (jednokratnost = DELETE … RETURNING), nikad ne mijenja.
GRANT SELECT, INSERT, DELETE ON account_tokens TO arqus_app;
--> statement-breakpoint
ALTER TABLE account_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE account_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Neprijavljeni zahtjev (prihvaćanje pozivnice, nova lozinka) traži redak po hashu bez stanara: politika tada otkriva
-- SAMO redak čiji je hash postavljen u transakciji (`app.account_token_hash`) – tokeni se ne mogu nabrojati (kao 0027).
CREATE POLICY account_tokens_select ON account_tokens FOR SELECT USING (
  tenant_id = app_current_tenant()
  OR (app_current_tenant() IS NULL AND token_hash = nullif(current_setting('app.account_token_hash', true), ''))
);
--> statement-breakpoint
CREATE POLICY account_tokens_insert ON account_tokens FOR INSERT WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY account_tokens_delete ON account_tokens FOR DELETE USING (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Zapis isporuke e-pošte: samo dodavanje i čitanje unutar stanara (bez sadržaja poruke).
GRANT SELECT, INSERT ON mail_deliveries TO arqus_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE mail_deliveries_id_seq TO arqus_app;
--> statement-breakpoint
ALTER TABLE mail_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE mail_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mail_deliveries_tenant ON mail_deliveries USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Dnevni sažetak: redak po korisniku i danu (jedinstven indeks = najviše jedan sažetak dnevno); mijenja se samo ishod.
GRANT SELECT, INSERT ON digest_runs TO arqus_app;
--> statement-breakpoint
GRANT UPDATE (outcome, finished_at) ON digest_runs TO arqus_app;
--> statement-breakpoint
ALTER TABLE digest_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE digest_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY digest_runs_tenant ON digest_runs USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
