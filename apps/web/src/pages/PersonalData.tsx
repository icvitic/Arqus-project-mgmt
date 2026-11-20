import { useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { date, dateTime } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { AnonymisePreview, Me, PrivacyPeople, PrivacySubject, RetentionOverview, RetentionRun } from '../lib/types';
import { ActionButton, ActionForm, Chip, Dialog, ErrorBox, Field, Loading, TabList, TabPanel, announce } from '../ui';
import { can } from '../lib/access';
import { RequestsTab } from './SubjectRequests';

const CATEGORY_LABELS: Record<string, string> = {
  account: 'Korisnički račun', roles: 'Uloge', sessions: 'Sesije', accountTokens: 'Pozivnice i poveznice', calendar: 'Kalendar', notifications: 'Obavijesti',
  mailDeliveries: 'Isporuka e-pošte', digestRuns: 'Dnevni sažetak', teamMemberships: 'Članstva u timovima', timesheets: 'Timesheetovi', personnelCosts: 'Troškovi osoblja',
  responsibilities: 'Odgovornosti', risks: 'Rizici', projectsManaged: 'Projekti koje vodi', proposalsLed: 'Prijave koje vodi', callTracking: 'Praćenje poziva',
  subjectRequests: 'Zahtjevi za ostvarivanje prava', documents: 'Dokumenti koje je prenijela', audit: 'Revizijski zapis',
};
const PROJECT_STATUS: Record<string, string> = { contracting: 'u ugovaranju', active: 'aktivan', suspended: 'obustavljen', closing: 'u završetku', closed: 'zatvoren', terminated: 'prekinut', archived: 'arhiviran' };
const STATUS: Record<string, string> = { active: 'aktivan', invited: 'pozvan', disabled: 'deaktiviran', closed: 'zatvoren' };

/**
 * WP1.23 – „Osobni podaci” (samo `privacy:manage`, administrator): prava ispitanika za jednu osobu (izvoz, zatvaranje računa,
 * anonimizacija nakon roka čuvanja) i rokovi čuvanja po vrsti podatka; WP1.24 – evidencija zahtjeva ispitanika s rokom za odgovor. Nepovratne radnje traže upisano ime osobe.
 */
export function PersonalData({ me, tab }: { me: Me; tab?: string }) {
  if (!can(me, 'privacy:manage')) return <><h1>Osobni podaci</h1><p className="muted">Prava ispitanika i rokove čuvanja vodi administrator (dozvola privacy:manage).</p></>;
  const active = tab === 'rokovi' ? 'rokovi' : tab === 'zahtjevi' ? 'zahtjevi' : 'osoba';
  return (
    <>
      <h1>Osobni podaci</h1>
      <p className="sub">Institucija je voditelj obrade. Ovdje upisuješ zahtjeve ispitanika i pratiš rok za odgovor, osobi predaješ sve što sustav o njoj drži, zatvaraš račun osobe koja je otišla, nakon isteka roka čuvanja anonimiziraš njezine projektne zapise i postavljaš rokove čuvanja. Postupci po pravu: <code>docs/gdpr/PRAVA-ISPITANIKA.md</code>.</p>
      <TabList label="Osobni podaci" active={active} tabs={[{ key: 'osoba', label: 'Osoba (prava ispitanika)', href: '#/osobni-podaci' }, { key: 'zahtjevi', label: 'Zahtjevi i rokovi', href: '#/osobni-podaci/zahtjevi' }, { key: 'rokovi', label: 'Rokovi čuvanja', href: '#/osobni-podaci/rokovi' }]} />
      <TabPanel active={active}>{active === 'rokovi' ? <RetentionTab /> : active === 'zahtjevi' ? <RequestsTab /> : <PersonTab me={me} />}</TabPanel>
    </>
  );
}

function PersonTab({ me }: { me: Me }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PrivacyPeople | null>(null);
  const [subject, setSubject] = useState<{ userId: string | null; memberIds: string[] } | null>(null);
  return (
    <>
      <div className="card"><h2>Pronađi osobu</h2>
        <p className="muted">Osoba je korisnički račun i zapisi člana tima povezani s njim. Zapis člana tima bez računa sustav samo <b>predlaže</b> po imenu – ti ga izričito pripisuješ osobi. Zapis povezan s drugim računom ne može se pripisati.</p>
        <ActionForm submit="Traži" onSubmit={async () => { setFound(await api<PrivacyPeople>('GET', `/privacy/people?q=${encodeURIComponent(q)}`)); }}>
          <Field label="Ime, prezime ili e-adresa"><input value={q} onChange={(e) => setQ(e.target.value)} minLength={2} maxLength={100} required /></Field>
        </ActionForm>
        {found && (
          <div className="scroll">
            <table><caption className="sr-only">Pronađeni računi i zapisi člana tima</caption>
              <thead><tr><th>Osoba</th><th>Vrsta</th><th>Stanje</th><th><span className="sr-only">Radnja</span></th></tr></thead>
              <tbody>
                {found.users.map((u) => <tr key={u.id}><td>{u.displayName}<br /><small className="muted">{u.email}</small></td><td>korisnički račun</td><td>{STATUS[u.status] ?? u.status}</td>
                  <td><button onClick={() => setSubject({ userId: u.id, memberIds: [] })} aria-label={`Odaberi račun ${u.displayName}`}>Odaberi</button></td></tr>)}
                {found.members.filter((m) => !m.userId).map((m) => <tr key={m.id}><td>{m.fullName}</td><td>član tima bez računa · {m.acronym}</td><td>{m.anonymised ? 'anonimiziran' : m.active ? 'aktivan' : 'neaktivan'}</td>
                  <td><button onClick={() => setSubject({ userId: null, memberIds: [m.id] })} aria-label={`Odaberi zapis ${m.fullName} na projektu ${m.acronym}`}>Odaberi</button></td></tr>)}
                {!found.users.length && !found.members.length && <tr><td colSpan={4} className="muted">Nema rezultata.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {subject && <SubjectCard key={`${subject.userId}-${subject.memberIds.join(',')}`} me={me} subject={subject} onChange={setSubject} />}
    </>
  );
}

function SubjectCard({ me, subject, onChange }: { me: Me; subject: { userId: string | null; memberIds: string[] }; onChange: (s: { userId: string | null; memberIds: string[] }) => void }) {
  const st = useLoad(() => api<PrivacySubject>('POST', '/privacy/subject', subject), [subject.userId, subject.memberIds.join(',')]);
  const [closing, setClosing] = useState(false);
  const [anon, setAnon] = useState<string | null>(null);
  const s = st.data;
  const name = s?.user?.displayName ?? s?.members[0]?.fullName ?? '';
  const exportUrl = `/privacy/export?${new URLSearchParams({ ...(subject.userId ? { userId: subject.userId } : {}), ...(subject.memberIds.length ? { memberIds: subject.memberIds.join(',') } : {}) })}`;
  return (
    <div className="card privacy-subject"><h2>{name || 'Osoba'}</h2>
      <ErrorBox error={st.error} />
      {!s ? <Loading /> : (
        <>
          {s.user && <p>Korisnički račun: <b>{s.user.email}</b> · <Chip s={STATUS[s.user.status] ?? s.user.status} tone={s.user.status === 'closed' ? undefined : s.user.status === 'active' ? 'ok' : 'warn'} />{s.user.closedAt && <> · zatvoren {dateTime(s.user.closedAt)}</>}</p>}
          <h3>Zapisi člana tima</h3>
          {!s.members.length ? <p className="muted">Osoba nema zapisa člana tima.</p> : (
            <div className="scroll"><table><caption className="sr-only">Zapisi člana tima pripisani osobi</caption>
              <thead><tr><th>Projekt</th><th>Ime u zapisu</th><th>Pripisano</th><th>Rok čuvanja</th><th><span className="sr-only">Radnja</span></th></tr></thead>
              <tbody>{s.members.map((m) => (
                <tr key={m.id}><td>{m.project}<br /><small className="muted">{m.partner}</small></td><td>{m.fullName}{m.anonymised && <> <Chip s="anonimiziran" /></>}</td>
                  <td>{m.linked ? 'povezan s računom' : 'izričito pripisan'}</td>
                  <td>{m.retentionEnd ? `${m.retentionRunning ? 'traje do' : 'istekao'} ${date(m.retentionEnd)}` : 'nije počeo'}</td>
                  <td>{!m.anonymised && <button onClick={() => setAnon(m.id)} aria-label={`Anonimiziraj zapis ${m.fullName} na projektu ${m.project}`}>Anonimiziraj…</button>}</td></tr>
              ))}</tbody></table></div>
          )}
          {s.candidates.length > 0 && (
            <>
              <h3>Mogući zapisi iste osobe (bez računa)</h3>
              <p className="muted">Isto ime ne znači istu osobu. Pripiši zapis samo ako si provjerio/la da je riječ o istoj osobi (npr. ugovor, OIB u kadrovskoj evidenciji).</p>
              <ul>{s.candidates.map((c) => <li key={c.id}>{c.fullName} · {c.project} ({c.partner}) <button onClick={() => onChange({ ...subject, memberIds: [...subject.memberIds, c.id] })} aria-label={`Pripiši zapis ${c.fullName} na projektu ${c.project} ovoj osobi`}>Pripiši</button></li>)}</ul>
            </>
          )}
          <h3>Što sustav drži o osobi</h3>
          <div className="scroll"><table className="privacy-counts"><caption className="sr-only">Broj zapisa po kategoriji</caption>
            <thead><tr><th>Kategorija</th><th className="num">Zapisa</th></tr></thead>
            <tbody>{Object.entries(s.counts).map(([k, n]) => <tr key={k}><td>{CATEGORY_LABELS[k] ?? k}</td><td className="num">{n}</td></tr>)}</tbody></table></div>
          {s.documents.length > 0 && (
            <>
              <h3>Dokumenti za pregled</h3>
              <p className="muted">Sadržaj datoteka sustav ne vidi i ne anonimizira. Pregledaj ih i odluči: predati osobi, zadržati (dokaz) ili obrisati na kartici „Dokumenti” projekta.</p>
              <ul>{s.documents.map((d, i) => <li key={i}>{d.title} · <code>{d.fileName}</code> (v{d.version}) · {d.project ?? '–'} · {date(d.uploadedAt)}{d.deleted && ' · obrisan'}</li>)}</ul>
            </>
          )}
          <div className="actions">
            <ActionButton kind="primary" onClick={async () => { await downloadFile(exportUrl, 'osobni-podaci.zip'); announce('Izvoz je preuzet'); }}>Preuzmi podatke osobe (ZIP)</ActionButton>
            {s.user && s.user.status !== 'closed' && s.user.id !== me.user.id && <button className="danger" onClick={() => setClosing(true)}>Zatvori račun…</button>}
          </div>
          <p className="muted small-note">{s.withAmounts ? 'Izvoz sadrži iznose plaća i troškova osoblja (imaš pristup podacima o plaćama).' : 'Izvoz NE sadrži iznose plaća i troškova osoblja – nemaš pristup podacima o plaćama (personnel:read); izvoz to navodi.'} Izvoz se bilježi u reviziju (tko, za koga, s iznosima ili bez – ne sadržaj).</p>
          {closing && s.user && <CloseDialog user={s.user} onClose={() => setClosing(false)} onDone={async () => { setClosing(false); await st.reload(); }} />}
          {anon && <AnonymiseDialog memberId={anon} onClose={() => setAnon(null)} onDone={async () => { setAnon(null); await st.reload(); }} />}
        </>
      )}
    </div>
  );
}

function CloseDialog({ user, onClose, onDone }: { user: { id: string; displayName: string; email: string }; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  return (
    <Dialog title={`Zatvoriti račun: ${user.displayName}?`} onClose={onClose} className="privacy-dialog">
      <p><b>Nepovratno.</b> Odmah nestaju: lozinka, dvofaktorska prijava, sve sesije, pozivnice i poveznice, kalendar, obavijesti, zapisi sažetka i isporuke pošte te uloge. E-adresa <code>{user.email}</code> zamjenjuje se adresom koja ne postoji, pa se račun ne može ni pronaći ni prijaviti.</p>
      <p><b>Ostaje:</b> ime i prezime na odobrenim timesheetovima, odlukama i u revizijskom zapisu (dokaz za zahtjeve koje financijer može provjeravati godinama) te zapisi člana tima – njih anonimiziraš nakon isteka roka čuvanja projekta.</p>
      <ActionForm submit="Zatvori račun" onSubmit={async () => { await api('POST', `/privacy/users/${user.id}/close`, { confirmation: typed, reason }); announce('Račun je zatvoren'); await onDone(); }}>
        <Field label="Razlog (bilježi se u reviziju)"><input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={1000} required /></Field>
        <Field label={`Za potvrdu upiši ime i prezime: ${user.displayName}`}><input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" required /></Field>
      </ActionForm>
      <div className="actions"><button onClick={onClose}>Odustani</button></div>
    </Dialog>
  );
}

function AnonymiseDialog({ memberId, onClose, onDone }: { memberId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const st = useLoad(() => api<AnonymisePreview>('POST', `/privacy/members/${memberId}/anonymise/preview`), [memberId]);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const p = st.data;
  return (
    <Dialog title="Anonimizacija zapisa člana tima" onClose={onClose} className="privacy-dialog wide">
      <ErrorBox error={st.error} />
      {!p ? <Loading /> : (
        <>
          <p><b>{p.member.fullName}</b> · {p.member.project} ({p.member.partner}). <b>Nepovratno.</b> Iznosi, sati, statusi i zahtjevi za nadoknadu ostaju isti; mijenja se samo ono što identificira osobu.</p>
          <p className={p.retention.running ? 'warnbox' : ''}>{p.retention.reason}{p.retention.running && ' Prije isteka roka anonimizacija traži zabilježen razlog (npr. zahtjev ispitanika koji je odobrio službenik za zaštitu podataka).'}</p>
          <h3>Mijenja se</h3>
          <ul>
            {p.changes.teamMember.map((c) => <li key={c.field}>{c.field}: <del>{c.before}</del> → {c.after ?? <i>prazno</i>}</li>)}
            {p.changes.expenses.length > 0 && <li>opis {p.changes.expenses.length} troška osoblja: npr. „{p.changes.expenses[0]!.before}” → „{p.changes.expenses[0]!.after}”</li>}
          </ul>
          <h3>Ostaje nepromijenjeno</h3>
          <p>{p.unchanged.timesheets} timesheetova ({(p.unchanged.minutes / 60).toLocaleString('hr-HR')} h), {p.unchanged.personnelExpenses} troškova osoblja s iznosima, {p.unchanged.responsibilities} odgovornosti (prikazuju pseudonim).</p>
          {p.flagged.length > 0 && (
            <>
              <h3>Slobodni tekst koji spominje ime – pregledaj ručno</h3>
              <p className="muted">Sustav ga ne mijenja (dio je predanog zahtjeva ili teksta projekta); ispravi ga ručno gdje je dopušteno.</p>
              <ul>{p.flagged.map((f, i) => <li key={i}>{f.where} {f.ref}: {f.text}</li>)}</ul>
            </>
          )}
          {p.documents.length > 0 && (
            <>
              <h3>Dokumenti koje je osoba prenijela na projekt</h3>
              <p className="muted">Sadržaj datoteka sustav ne vidi i ne anonimizira – pregledaj ih i obriši ili zadrži.</p>
              <ul>{p.documents.map((d) => <li key={d.id}>{d.title} · <code>{d.fileName}</code></li>)}</ul>
            </>
          )}
          <ActionForm submit="Anonimiziraj" onSubmit={async () => { await api('POST', `/privacy/members/${memberId}/anonymise`, { confirmation: typed, fingerprint: p.fingerprint, reason: reason || null }); announce(`Zapis je anonimiziran: ${p.pseudonym}`); await onDone(); }}>
            {p.retention.running && <Field label="Razlog anonimizacije prije isteka roka (najmanje 10 znakova)"><input value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={1000} required /></Field>}
            <Field label={`Za potvrdu upiši ime i prezime: ${p.member.fullName}`} hint={`Nakon potvrde zapis se prikazuje kao „${p.pseudonym}”.`}><input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" required /></Field>
          </ActionForm>
        </>
      )}
      <div className="actions"><button onClick={onClose}>Odustani</button></div>
    </Dialog>
  );
}

const runSummary = (r: RetentionRun | null) => {
  if (!r) return null;
  const removed = (r.result?.categories ?? []).reduce((a, c) => a + (c.removed ?? 0), 0);
  return { removed, at: r.finishedAt ?? r.startedAt, byKey: Object.fromEntries((r.result?.categories ?? []).map((c) => [c.key, c])) };
};

function RetentionTab() {
  const st = useLoad(() => api<RetentionOverview>('GET', '/privacy/retention'), []);
  const [days, setDays] = useState<Record<string, string>>({});
  const [years, setYears] = useState<Record<string, string>>({});
  const [inst, setInst] = useState('');
  const [confirm, setConfirm] = useState(false);
  const o = st.data;
  const last = runSummary(o?.lastRun ?? null);
  const dry = runSummary(o?.lastDryRun ?? null);
  return (
    <>
      <ErrorBox error={st.error} />
      {!o ? <Loading /> : (
        <>
          <div className={o.confirmed.at ? 'card' : 'card warnbox'}>
            <h2>Stanje</h2>
            <p>{o.confirmed.at ? <>Rokove je institucija potvrdila {dateTime(o.confirmed.at)}.</> : <><b>Rokovi nisu potvrđeni.</b> Zadani rokovi su prijedlog razvojnog tima, ne pravni savjet – provjerite ih sa službenikom za zaštitu podataka i potvrdite ispod.</>}</p>
            <p>Posao čuvanja {o.scheduler.enabled ? <>radi svaki dan od {o.scheduler.hour}:00 (zona institucije)</> : <b>na ovoj instalaciji nije uključen</b>}. Zadnje izvođenje: {last ? <>{dateTime(last.at)} – uklonjeno <b>{last.removed}</b> zapisa</> : 'još nije bilo'}. Zadnje probno: {dry ? <>{dateTime(dry.at)} – isteklo bi {o.lastDryRun?.result?.categories?.reduce((a, c) => a + c.eligible, 0) ?? 0}</> : 'još nije bilo'}.</p>
            <div className="actions"><ActionButton onClick={async () => { await api('POST', '/privacy/retention/dry-run'); await st.reload(); announce('Probno izvođenje je gotovo – ništa nije obrisano'); }}>Probno izvođenje (ništa ne briše)</ActionButton></div>
          </div>
          <div className="card"><h2>Rokovi po vrsti podatka</h2>
            <div className="scroll"><table className="retention-table"><caption className="sr-only">Rokovi čuvanja po kategoriji</caption>
              <thead><tr><th>Kategorija</th><th>Rok</th><th>Zadano / najmanje</th><th className="num">Drži se</th><th className="num">Isteklo</th><th className="num">Čuva se preko roka</th><th className="num">Zadnje uklonjeno</th></tr></thead>
              <tbody>{o.categories.map((c) => (
                <tr key={c.key}><td>{c.label}<br /><small className="muted">{c.basis}</small></td>
                  <td>{c.configurable ? <label><span className="sr-only">Rok za {c.label} ({c.unit})</span><input type="number" className="days-input" min={c.floorDays} max={36500} value={days[c.key] ?? String(c.days)} onChange={(e) => setDays({ ...days, [c.key]: e.target.value })} /></label> : <b>{c.days}</b>} <small>{c.unit}</small>{c.setByInstitution && <><br /><small className="muted">postavila institucija</small></>}</td>
                  <td>{c.defaultDays} / {c.floorDays}{!c.configurable && <><br /><small className="muted">nije promjenjivo</small></>}</td>
                  <td className="num">{c.held}</td><td className="num">{c.eligible}</td><td className="num">{c.keptForEvidence || '–'}</td><td className="num">{last?.byKey[c.key]?.removed ?? '–'}</td></tr>
              ))}</tbody></table></div>
            <p className="muted small-note">„Čuva se preko roka”: revizijski zapisi iz razdoblja projekta kojemu rok čuvanja još traje i obrisani dokumenti koji su dokaz troška u zahtjevu – brišu se tek kad istekne rok projekta. Zatvoreni računi: {o.kept.closedAccounts} (ime ostaje zbog dokaza; s njima povezanih zapisa člana tima: {o.kept.closedAccountMembers}); anonimiziranih zapisa člana tima: {o.kept.anonymisedMembers}.</p>
          </div>
          <div className="card"><h2>Rok čuvanja projekta</h2>
            <p className="muted">Financijski zapisi (timesheetovi, troškovi, zahtjevi) čuvaju se dok traje rok čuvanja projekta. Rok teče od kasnijeg od: kraja projekta, posljednje isplate ili odluke o zahtjevu – i tek kad je projekt zatvoren, raskinut ili arhiviran. Pravila programa se razlikuju; bez postavke vrijedi <b>{o.projectYears.defaultYears} godina (zadano, nije pravni savjet)</b>, nikad manje od {o.projectYears.floorYears}.</p>
            <ActionForm submit="Spremi rokove" onSubmit={async () => {
              const retentionDays: Record<string, number> = {};
              for (const c of o.categories) if (c.configurable && days[c.key] !== undefined && Number(days[c.key]) !== c.days) retentionDays[c.key] = Number(days[c.key]);
              const programmes: Record<string, number | null> = {};
              for (const p of o.projectYears.programmes) if (years[p.packageId] !== undefined) programmes[p.packageId] = years[p.packageId] === '' ? null : Number(years[p.packageId]);
              st.setData(await api<RetentionOverview>('PUT', '/privacy/retention', { retentionDays, projectYears: { ...(inst !== '' ? { default: Number(inst) } : {}), programmes }, confirm }));
              setDays({}); setYears({}); setInst(''); setConfirm(false); announce('Rokovi su spremljeni');
            }}>
              <Field label="Zadani rok institucije (godine)" hint={o.projectYears.institutionYears ? `postavljeno: ${o.projectYears.institutionYears}` : `nije postavljeno – vrijedi ${o.projectYears.defaultYears} (zadano)`}>
                <input type="number" min={o.projectYears.floorYears} max={50} value={inst} placeholder={String(o.projectYears.institutionYears ?? o.projectYears.defaultYears)} onChange={(e) => setInst(e.target.value)} />
              </Field>
              {o.projectYears.programmes.map((p) => (
                <Field key={p.packageId} label={`Paket programa ${p.packageId} (godine)`} hint={p.source === 'programme' ? `postavljeno za paket: ${p.years}` : p.source === 'institution' ? `vrijedi rok institucije: ${p.years}` : `vrijedi zadano: ${p.years} (nije potvrđeno)`}>
                  <input type="number" min={o.projectYears.floorYears} max={50} value={years[p.packageId] ?? ''} placeholder={String(p.years)} onChange={(e) => setYears({ ...years, [p.packageId]: e.target.value })} />
                </Field>
              ))}
              <label className="switch-row"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /><span>Potvrđujem rokove: institucija ih je provjerila (bilježi se tko i kada).</span></label>
            </ActionForm>
            <div className="scroll"><table><caption className="sr-only">Rok čuvanja po projektu</caption>
              <thead><tr><th>Projekt</th><th>Status</th><th>Paket</th><th className="num">Godine</th><th>Kraj roka</th></tr></thead>
              <tbody>{o.projects.map((p) => <tr key={p.id}><td>{p.acronym}</td><td>{PROJECT_STATUS[p.status] ?? p.status}</td><td>{p.packageId}</td><td className="num">{p.years}</td>
                <td>{p.retentionEnd ? <>{date(p.retentionEnd)} {p.state === 'ended' ? <Chip s="istekao" tone="ok" /> : <Chip s="traje" />}</> : <span className="muted">nije počeo</span>}</td></tr>)}</tbody></table></div>
          </div>
        </>
      )}
    </>
  );
}
