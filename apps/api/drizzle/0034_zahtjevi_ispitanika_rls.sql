-- WP1.24: evidencija zahtjeva ispitanika. Aplikacija zahtjev stvara i mijenja; brisanje ima samo posao čuvanja
-- (zatvoreni zahtjevi stariji od roka kategorije `subjectRequests`) – ruta za brisanje ne postoji.
GRANT SELECT, INSERT, UPDATE, DELETE ON subject_requests TO arqus_app;
--> statement-breakpoint
ALTER TABLE subject_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE subject_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY subject_requests_tenant ON subject_requests USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Otvoren zahtjev se ne briše ni izravnim upitom: evidencija je dokaz postupanja (čl. 5(2) GDPR-a), a rok čuvanja
-- teče tek od zatvaranja. Vrijedi i za vlasničku ulogu.
CREATE OR REPLACE FUNCTION subject_requests_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'closed' THEN
    RAISE EXCEPTION 'Otvoren zahtjev ispitanika se ne briše' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER subject_requests_delete_guard_trg BEFORE DELETE ON subject_requests FOR EACH ROW EXECUTE FUNCTION subject_requests_delete_guard();
