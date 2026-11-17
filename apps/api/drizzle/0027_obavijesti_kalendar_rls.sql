-- WP1.18: obavijesti i tokeni osobnog kalendara.
-- Trenutni korisnik iz postavke transakcije (NULL ako nije postavljen) – postavlja ga servis obavijesti prije čitanja.
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
-- Obavijesti: upisuje ih akter za drugog korisnika (isti stanar); čita, označava pročitanim i briše samo vlasnik.
-- Aplikacija smije mijenjati samo `read_at` (sadržaj obavijesti je nepromjenjiv).
GRANT SELECT, INSERT, DELETE ON notifications TO arqus_app;
--> statement-breakpoint
GRANT UPDATE (read_at) ON notifications TO arqus_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE notifications_id_seq TO arqus_app;
--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_insert ON notifications FOR INSERT WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Bez postavljenog `app.user_id` nijedan redak nije vidljiv (fail-closed): greška u upitu ne može vratiti tuđe obavijesti.
CREATE POLICY notifications_owner_select ON notifications FOR SELECT USING (tenant_id = app_current_tenant() AND user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY notifications_owner_update ON notifications FOR UPDATE USING (tenant_id = app_current_tenant() AND user_id = app_current_user()) WITH CHECK (tenant_id = app_current_tenant() AND user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY notifications_owner_delete ON notifications FOR DELETE USING (tenant_id = app_current_tenant() AND user_id = app_current_user());
--> statement-breakpoint
-- Tokeni kalendara: izmjene samo unutar stanara. Neprijavljeni dohvat feeda traži redak po hashu bez stanara – politika
-- tada otkriva SAMO redak čiji je hash postavljen u transakciji (`app.calendar_token_hash`), pa se tokeni ne mogu nabrojati.
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_tokens TO arqus_app;
--> statement-breakpoint
ALTER TABLE calendar_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE calendar_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY calendar_tokens_select ON calendar_tokens FOR SELECT USING (
  tenant_id = app_current_tenant()
  OR (app_current_tenant() IS NULL AND token_hash = nullif(current_setting('app.calendar_token_hash', true), ''))
);
--> statement-breakpoint
CREATE POLICY calendar_tokens_insert ON calendar_tokens FOR INSERT WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY calendar_tokens_update ON calendar_tokens FOR UPDATE USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY calendar_tokens_delete ON calendar_tokens FOR DELETE USING (tenant_id = app_current_tenant());
