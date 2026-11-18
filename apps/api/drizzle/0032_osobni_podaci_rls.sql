-- WP1.23: osobni podaci u proizvodu (GDPR) – prava, rokovi čuvanja i jedini kontrolirani putovi brisanja.
-- Vlasnička uloga je u instalaciji superuser (zaobilazi RLS), pa svaka SECURITY DEFINER funkcija ispod IZRIČITO filtrira
-- po `app_current_tenant()` (stanar iz transakcije pozivatelja) i odbija rad bez njega.

-- 1. Izvođenja posla čuvanja: aplikacija ih stvara i dovršava, ne briše.
GRANT SELECT, INSERT ON retention_runs TO arqus_app;
--> statement-breakpoint
GRANT UPDATE (outcome, result, finished_at) ON retention_runs TO arqus_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE retention_runs_id_seq TO arqus_app;
--> statement-breakpoint
ALTER TABLE retention_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE retention_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retention_runs_tenant ON retention_runs USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- 2. Brisanje zapisa bez dokazne svrhe (zatvaranje računa i posao čuvanja): sesije (IP, preglednik), zapis isporuke pošte
-- i dnevni sažetak. Ni jedan nije financijski ni revizijski dokaz; RLS po stanaru vrijedi i za DELETE.
GRANT DELETE ON sessions, mail_deliveries, digest_runs TO arqus_app;
--> statement-breakpoint
-- 3. Revizijski zapis ostaje samo za dodavanje (aplikacija i dalje nema UPDATE/DELETE – migracija 0001). Okidač dodatno
-- odbija izmjenu i brisanje i vlasničkoj ulozi, osim brisanja unutar funkcije `privacy_audit_purge` (jedini put).
CREATE OR REPLACE FUNCTION audit_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('arqus.audit_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Revizijski zapis je samo za dodavanje (%)', TG_OP USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_entries_guard_trg BEFORE UPDATE OR DELETE ON audit_entries FOR EACH ROW EXECUTE FUNCTION audit_entries_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_entries_truncate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Revizijski zapis se ne prazni (TRUNCATE)' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_entries_truncate_trg BEFORE TRUNCATE ON audit_entries FOR EACH STATEMENT EXECUTE FUNCTION audit_entries_truncate_guard();
--> statement-breakpoint
-- 4. Rok čuvanja projekta (godine) iz postavke institucije: po paketu programa, inače zadano institucije, inače 10.
-- Donja granica 3 godine vrijedi bez obzira na postavku.
CREATE OR REPLACE FUNCTION privacy_project_years(p_settings jsonb, p_package text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT greatest(3, least(50, coalesce(
    nullif(p_settings #>> ARRAY['privacy', 'projectYears', 'programmes', p_package], '')::integer,
    nullif(p_settings #>> '{privacy,projectYears,default}', '')::integer,
    10)))
$$;
--> statement-breakpoint
-- Kraj roka čuvanja projekta: NULL dok rok nije počeo (projekt nije zatvoren, raskinut ili arhiviran; ima predan
-- neodlučen zahtjev; ili se početak ne može odrediti). Inače: najkasniji od (kraj projekta = početak + trajanje,
-- posljednja isplata, posljednja odluka o zahtjevu) + godine čuvanja.
CREATE OR REPLACE FUNCTION project_retention_end(p_project uuid) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p.status NOT IN ('closed', 'terminated', 'archived') THEN NULL
    WHEN EXISTS (SELECT 1 FROM reimbursement_claims c WHERE c.tenant_id = p.tenant_id AND c.project_id = p.id AND c.status = 'submitted') THEN NULL
    ELSE (greatest(
      (p.start_date + make_interval(months => coalesce(p.duration_months, 0)))::date - 1,
      (SELECT max(greatest(c.paid_at, c.decision_date)) FROM reimbursement_claims c WHERE c.tenant_id = p.tenant_id AND c.project_id = p.id)
    ) + make_interval(years => privacy_project_years(t.settings, p.package_id)))::date
  END
  FROM projects p JOIN tenants t ON t.id = p.tenant_id
  WHERE p.id = p_project AND p.tenant_id = app_current_tenant()
$$;
--> statement-breakpoint
-- 5. Jedini put brisanja revizijskih zapisa: istekli zapisi neuspjelih prijava (zadano 365 dana, najmanje 90) i ostali
-- zapisi stariji od roka revizije (zadano 3650 dana, najmanje 1825) koji su UJEDNO stariji od nastanka najstarijeg
-- projekta kojemu rok čuvanja još traje (zapis o radnji na takvom projektu je dokaz). Donje granice su u funkciji, ne u
-- postavci. Samo stanar iz transakcije; jedna vrsta po pozivu (`login` ili `general`); najviše 5000 redaka po pozivu;
-- brisanje ostavlja vlastiti revizijski zapis.
CREATE OR REPLACE FUNCTION privacy_audit_purge(p_kind text, p_limit integer, p_dry boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := app_current_tenant();
  s jsonb;
  audit_days integer; login_days integer;
  cutoff timestamptz; login_cutoff timestamptz; horizon timestamptz;
  n_login bigint; n_general bigint; n_kept bigint; removed integer := 0; removed_login integer := 0; lim integer;
BEGIN
  IF t IS NULL THEN RAISE EXCEPTION 'privacy_audit_purge: nema stanara u transakciji' USING ERRCODE = '42501'; END IF;
  lim := least(greatest(coalesce(p_limit, 0), 0), 5000);
  SELECT settings INTO s FROM tenants WHERE id = t;
  audit_days := greatest(1825, coalesce(nullif(s #>> '{privacy,retentionDays,audit}', '')::integer, 3650));
  login_days := greatest(90, coalesce(nullif(s #>> '{privacy,retentionDays,loginFailures}', '')::integer, 365));
  cutoff := now() - make_interval(days => audit_days);
  login_cutoff := now() - make_interval(days => login_days);
  SELECT min(p.created_at) INTO horizon FROM projects p
    WHERE p.tenant_id = t AND (project_retention_end(p.id) IS NULL OR project_retention_end(p.id) > current_date);
  SELECT count(*) INTO n_login FROM audit_entries a WHERE a.tenant_id = t AND a.entity = 'user' AND a.action IN ('login.failed', 'login.mfa_failed') AND a.at < login_cutoff;
  SELECT count(*) INTO n_general FROM audit_entries a WHERE a.tenant_id = t AND a.at < cutoff AND (horizon IS NULL OR a.at < horizon)
    AND NOT (a.entity = 'user' AND a.action IN ('login.failed', 'login.mfa_failed') AND a.at < login_cutoff);
  SELECT count(*) INTO n_kept FROM audit_entries a WHERE a.tenant_id = t AND a.at < cutoff AND horizon IS NOT NULL AND a.at >= horizon
    AND NOT (a.entity = 'user' AND a.action IN ('login.failed', 'login.mfa_failed') AND a.at < login_cutoff);
  IF p_kind NOT IN ('login', 'general') THEN RAISE EXCEPTION 'privacy_audit_purge: vrsta mora biti login ili general' USING ERRCODE = '22023'; END IF;
  IF NOT coalesce(p_dry, true) AND lim > 0 AND ((p_kind = 'login' AND n_login > 0) OR (p_kind = 'general' AND n_general > 0)) THEN
    PERFORM set_config('arqus.audit_purge', 'on', true);
    IF p_kind = 'login' THEN
    DELETE FROM audit_entries WHERE id IN (
      SELECT a.id FROM audit_entries a WHERE a.tenant_id = t AND a.entity = 'user' AND a.action IN ('login.failed', 'login.mfa_failed') AND a.at < login_cutoff
      ORDER BY a.id LIMIT lim);
    GET DIAGNOSTICS removed_login = ROW_COUNT;
    ELSE
      DELETE FROM audit_entries WHERE id IN (
        SELECT a.id FROM audit_entries a WHERE a.tenant_id = t AND a.at < cutoff AND (horizon IS NULL OR a.at < horizon)
        ORDER BY a.id LIMIT lim);
      GET DIAGNOSTICS removed = ROW_COUNT;
    END IF;
    PERFORM set_config('arqus.audit_purge', '', true);
    IF removed + removed_login > 0 THEN
      INSERT INTO audit_entries (tenant_id, actor_type, entity, action, diff) VALUES (t, 'system', 'privacy', 'audit.purge', jsonb_build_object('meta',
        jsonb_build_object('removed', removed, 'removedLogin', removed_login, 'auditDays', audit_days, 'loginDays', login_days, 'cutoff', cutoff, 'loginCutoff', login_cutoff, 'evidenceHorizon', horizon, 'source', 'privacy_audit_purge')));
    END IF;
  END IF;
  RETURN jsonb_build_object('eligibleLogin', n_login, 'eligibleGeneral', n_general, 'keptForEvidence', n_kept, 'removed', removed, 'removedLogin', removed_login,
    'held', (SELECT count(*) FROM audit_entries a WHERE a.tenant_id = t),
    'auditDays', audit_days, 'loginDays', login_days, 'cutoff', cutoff, 'loginCutoff', login_cutoff, 'evidenceHorizon', horizon);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION privacy_audit_purge(text, integer, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION privacy_audit_purge(text, integer, boolean) TO arqus_app;
--> statement-breakpoint
-- 6. Trajno brisanje logički obrisanih dokumenata (zadano 180 dana nakon brisanja, najmanje 30). Dokument troška u
-- zahtjevu, odlučenog ili potraživanog izvan sustava i dokument zahtjeva brišu se tek kad je istekao rok čuvanja projekta.
-- Verzije (samo INSERT za aplikaciju) brišu se kaskadno. Vraća ključeve pohrane – datoteke briše aplikacija nakon potvrde.
CREATE OR REPLACE FUNCTION privacy_documents_purge(p_days integer, p_limit integer, p_dry boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := app_current_tenant();
  days integer := greatest(30, coalesce(p_days, 180));
  lim integer := least(greatest(coalesce(p_limit, 0), 0), 1000);
  ids uuid[]; keys jsonb := '[]'::jsonb; n_eligible bigint; n_kept bigint;
BEGIN
  IF t IS NULL THEN RAISE EXCEPTION 'privacy_documents_purge: nema stanara u transakciji' USING ERRCODE = '42501'; END IF;
  WITH c AS (
    SELECT d.id, (
      (d.entity_type = 'claim' OR (d.entity_type = 'expense' AND EXISTS (SELECT 1 FROM expenses e WHERE e.tenant_id = t AND e.id = d.entity_id
        AND (e.claim_id IS NOT NULL OR e.status <> 'recorded'))))
      AND (d.project_id IS NULL OR project_retention_end(d.project_id) IS NULL OR project_retention_end(d.project_id) > current_date)) AS evidence
    FROM documents d WHERE d.tenant_id = t AND d.deleted_at IS NOT NULL AND d.deleted_at < now() - make_interval(days => days))
  SELECT count(*) FILTER (WHERE NOT evidence), count(*) FILTER (WHERE evidence),
         (array_agg(id ORDER BY id) FILTER (WHERE NOT evidence))[1:lim]
    INTO n_eligible, n_kept, ids FROM c;
  IF coalesce(p_dry, true) OR lim = 0 THEN ids := NULL; END IF;
  IF ids IS NOT NULL AND array_length(ids, 1) > 0 THEN
    SELECT coalesce(jsonb_agg(v.storage_key), '[]'::jsonb) INTO keys FROM document_versions v WHERE v.tenant_id = t AND v.document_id = ANY(ids);
    DELETE FROM documents d WHERE d.tenant_id = t AND d.id = ANY(ids);
    INSERT INTO audit_entries (tenant_id, actor_type, entity, action, diff) VALUES (t, 'system', 'privacy', 'documents.purge', jsonb_build_object('meta',
      jsonb_build_object('removed', array_length(ids, 1), 'documentIds', to_jsonb(ids), 'days', days, 'source', 'privacy_documents_purge')));
  END IF;
  RETURN jsonb_build_object('eligible', n_eligible, 'keptForEvidence', n_kept, 'removed', coalesce(array_length(ids, 1), 0), 'storageKeys', keys, 'days', days);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION privacy_documents_purge(integer, integer, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION privacy_documents_purge(integer, integer, boolean) TO arqus_app;
--> statement-breakpoint
-- 7. Nepromjenjivost troškova (0021, 0025) s jednom novom, uskom iznimkom: anonimizacija člana tima smije u opisu
-- njegova troška osoblja (iz timesheeta ili potraživanog izvan sustava) zamijeniti ime pseudonimom – ništa drugo.
-- Transakcija najavljuje člana (`app.privacy_anonymise`) i staro ime (`app.privacy_anonymise_name`); član mora već biti
-- označen anonimiziranim (pseudonim), novi opis mora biti točno `replace(stari, ime, pseudonim)`, svi ostali stupci
-- nepromijenjeni. Okidač sam upisuje revizijski zapis (bez imena).
CREATE OR REPLACE FUNCTION expenses_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  anon_member text := nullif(current_setting('app.privacy_anonymise', true), '');
  anon_name text := nullif(current_setting('app.privacy_anonymise_name', true), '');
  pseud text;
BEGIN
  IF TG_OP = 'UPDATE' AND anon_member IS NOT NULL AND anon_name IS NOT NULL AND length(anon_name) >= 2
     AND OLD.status IN ('historic', 'accepted', 'partially_accepted', 'rejected') THEN
    SELECT m.pseudonym INTO pseud FROM team_members m
      WHERE m.tenant_id = OLD.tenant_id AND m.id::text = anon_member AND m.anonymised_at IS NOT NULL AND m.pseudonym IS NOT NULL
        AND (m.id = OLD.team_member_id OR m.id = (SELECT ts.team_member_id FROM timesheets ts WHERE ts.tenant_id = OLD.tenant_id AND ts.id = OLD.timesheet_id));
    IF pseud IS NOT NULL
       AND (to_jsonb(NEW) - 'description') = (to_jsonb(OLD) - 'description')
       AND NEW.description = replace(OLD.description, anon_name, pseud)
       AND NEW.description IS DISTINCT FROM OLD.description THEN
      INSERT INTO audit_entries (tenant_id, actor_type, actor_id, entity, entity_id, action, diff)
      VALUES (OLD.tenant_id, 'system', nullif(current_setting('app.privacy_actor', true), '')::uuid, 'expense', OLD.id::text, 'description.anonymise', jsonb_build_object(
        'meta', jsonb_build_object('teamMemberId', anon_member, 'status', OLD.status, 'source', 'expenses_immutable_trg')));
      RETURN NEW;
    END IF;
  END IF;
  IF OLD.status = 'historic' THEN
    IF TG_OP = 'DELETE' AND OLD.import_id IS NOT NULL AND OLD.import_id::text = current_setting('app.import_undo', true) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Trošak potraživan izvan sustava je nepromjenjiv (uklanja se samo poništavanjem uvoza)' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('accepted', 'partially_accepted', 'rejected') THEN
    IF TG_OP = 'UPDATE'
       AND OLD.claim_id IS NOT NULL
       AND OLD.claim_id::text = current_setting('app.claim_correction', true)
       AND NEW.status IN ('accepted', 'partially_accepted', 'rejected')
       AND (NEW.id, NEW.tenant_id, NEW.project_id, NEW.partner_id, NEW.category_code, NEW.work_package_id, NEW.date, NEW.description,
            NEW.supplier, NEW.amount_cents, NEW.evidence_ref, NEW.source, NEW.timesheet_id, NEW.claim_id, NEW.created_at, NEW.created_by, NEW.deleted_at,
            NEW.external_claim, NEW.team_member_id, NEW.import_id)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.tenant_id, OLD.project_id, OLD.partner_id, OLD.category_code, OLD.work_package_id, OLD.date, OLD.description,
            OLD.supplier, OLD.amount_cents, OLD.evidence_ref, OLD.source, OLD.timesheet_id, OLD.claim_id, OLD.created_at, OLD.created_by, OLD.deleted_at,
            OLD.external_claim, OLD.team_member_id, OLD.import_id)
    THEN
      IF (NEW.recognised_cents, NEW.decision_reason, NEW.status) IS DISTINCT FROM (OLD.recognised_cents, OLD.decision_reason, OLD.status) THEN
        INSERT INTO audit_entries (tenant_id, actor_type, actor_id, entity, entity_id, action, diff)
        VALUES (OLD.tenant_id, 'system', NEW.updated_by, 'expense', OLD.id::text, 'recognition.correct', jsonb_build_object(
          'before', jsonb_build_object('status', OLD.status, 'recognised', OLD.recognised_cents, 'reason', OLD.decision_reason),
          'after', jsonb_build_object('status', NEW.status, 'recognised', NEW.recognised_cents, 'reason', NEW.decision_reason),
          'meta', jsonb_build_object('claimId', OLD.claim_id, 'source', 'expenses_immutable_trg')));
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Trošak u statusu % je nepromjenjiv', OLD.status USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
-- 8. Obavijesti čita i briše samo vlasnik (RLS po `app.user_id`, 0027). Posao čuvanja briše pročitane (zadano 90 dana,
-- najmanje 7) i nepročitane (zadano 365 dana, najmanje 90) obavijesti svih korisnika stanara kroz ovu funkciju –
-- bez čitanja sadržaja; vraća samo brojeve.
CREATE OR REPLACE FUNCTION privacy_notifications_purge(p_read_days integer, p_unread_days integer, p_limit integer, p_dry boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := app_current_tenant();
  read_cutoff timestamptz := now() - make_interval(days => greatest(7, coalesce(p_read_days, 90)));
  unread_cutoff timestamptz := now() - make_interval(days => greatest(90, coalesce(p_unread_days, 365)));
  lim integer := least(greatest(coalesce(p_limit, 0), 0), 5000);
  n_held bigint; n_read bigint; n_unread bigint; removed_read integer := 0; removed_unread integer := 0;
BEGIN
  IF t IS NULL THEN RAISE EXCEPTION 'privacy_notifications_purge: nema stanara u transakciji' USING ERRCODE = '42501'; END IF;
  SELECT count(*), count(*) FILTER (WHERE read_at IS NOT NULL AND read_at < read_cutoff), count(*) FILTER (WHERE read_at IS NULL AND created_at < unread_cutoff)
    INTO n_held, n_read, n_unread FROM notifications WHERE tenant_id = t;
  IF NOT coalesce(p_dry, true) AND lim > 0 THEN
    DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE tenant_id = t AND read_at IS NOT NULL AND read_at < read_cutoff ORDER BY id LIMIT lim);
    GET DIAGNOSTICS removed_read = ROW_COUNT;
    IF lim - removed_read > 0 THEN
      DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE tenant_id = t AND read_at IS NULL AND created_at < unread_cutoff ORDER BY id LIMIT lim - removed_read);
      GET DIAGNOSTICS removed_unread = ROW_COUNT;
    END IF;
  END IF;
  RETURN jsonb_build_object('held', n_held, 'eligibleRead', n_read, 'eligibleUnread', n_unread, 'removedRead', removed_read, 'removedUnread', removed_unread);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION privacy_notifications_purge(integer, integer, integer, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION privacy_notifications_purge(integer, integer, integer, boolean) TO arqus_app;
