import { useState } from 'react';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { PrivacyPeople, SubjectRequest, SubjectRequestList } from '../lib/types';
import { ActionButton, ActionForm, Chip, Dialog, ErrorBox, Field, Loading, announce } from '../ui';

const KIND: Record<string, string> = {
  access: 'pristup podacima (čl. 15)', rectification: 'ispravak (čl. 16)', erasure: 'brisanje (čl. 17)', restriction: 'ograničenje obrade (čl. 18)',
  portability: 'prenosivost (čl. 20)', objection: 'prigovor (čl. 21)', other: 'drugo',
};
const CHANNEL: Record<string, string> = { email: 'e-pošta', post: 'pošta', in_person: 'osobno', other: 'drugo' };
const OUTCOME: Record<string, string> = { fulfilled: 'udovoljeno', partly_fulfilled: 'djelomično udovoljeno', refused: 'odbijeno (s obrazloženjem)', withdrawn: 'povučen' };
const NOTE_REQUIRED = ['partly_fulfilled', 'refused'];

const days = (n: number) => { const d = Math.abs(n) % 10, h = Math.abs(n) % 100; return `${Math.abs(n)} ${d === 1 && h !== 11 ? 'dan' : 'dana'}`; };
function DueChip({ r }: { r: SubjectRequest }) {
  if (r.daysLeft === null) return null;
  if (r.state === 'overdue') return <Chip s={`kasni ${days(r.daysLeft)}`} tone="bad" />;
  if (r.daysLeft === 0) return <Chip s="rok je danas" tone="warn" />;
  return <Chip s={`još ${days(r.daysLeft)}`} tone={r.state === 'due_soon' ? 'warn' : undefined} />;
}

/**
 * WP1.24 – evidencija zahtjeva ispitanika: svaki zahtjev (pristup, ispravak, brisanje…) upisuje se s danom zaprimanja,
 * a sustav računa rok za odgovor (mjesec dana, uz produljenje tri) i pokazuje ga u „Moj rad”. Zahtjev se ne briše –
 * zatvorene uklanja posao čuvanja po isteku roka (Rokovi čuvanja).
 */
export function RequestsTab() {
  const st = useLoad(() => api<SubjectRequestList>('GET', '/privacy/requests'), []);
  const [form, setForm] = useState<SubjectRequest | 'new' | null>(null);
  const [extending, setExtending] = useState<SubjectRequest | null>(null);
  const [closing, setClosing] = useState<SubjectRequest | null>(null);
  const l = st.data;
  const done = async (message: string) => { setForm(null); setExtending(null); setClosing(null); await st.reload(); announce(message); };
  const open = l?.items.filter((r) => r.status === 'open') ?? [];
  const closed = l?.items.filter((r) => r.status === 'closed') ?? [];
  return (
    <>
      <ErrorBox error={st.error} />
      {!l ? <Loading /> : (
        <>
          <div className={l.summary.overdue ? 'card warnbox' : 'card'}>
            <h2>Rokovi</h2>
            <p>Otvoreno: <b>{l.summary.open}</b> · kasni: <b>{l.summary.overdue}</b> · rok u idućih 10 dana: <b>{l.summary.dueSoon}</b> · zatvoreno: {l.summary.closed}{l.summary.closedLate > 0 && <> (od toga nakon roka: {l.summary.closedLate})</>}</p>
            <p className="muted">Na zahtjev ispitanika odgovara se <b>u roku od mjesec dana od zaprimanja</b> (čl. 12(3) GDPR-a); rok se može produljiti za dva daljnja mjeseca ako je ispitanik o tome obaviješten unutar prvog mjeseca. Sustav rok računa kalendarski i ne pomiče ga s vikenda ili blagdana na idući radni dan – prikazani rok nikad nije kasniji od pravnog. Postoji li pravo u konkretnom slučaju i od kada rok teče procjenjuje institucija.</p>
            <div className="actions"><button className="primary" onClick={() => setForm('new')}>Novi zahtjev…</button></div>
          </div>
          <div className="card"><h2>Otvoreni zahtjevi</h2>
            {!open.length ? <p className="muted">Nema otvorenih zahtjeva.</p> : (
              <div className="scroll"><table className="requests-table"><caption className="sr-only">Otvoreni zahtjevi ispitanika po roku</caption>
                <thead><tr><th>Oznaka</th><th>Zaprimljen</th><th>Vrsta</th><th>Podnositelj</th><th>Rok za odgovor</th><th><span className="sr-only">Radnje</span></th></tr></thead>
                <tbody>{open.map((r) => (
                  <tr key={r.id}><td><b>{r.ref}</b></td><td>{date(r.receivedOn)}<br /><small className="muted">{CHANNEL[r.channel] ?? r.channel}</small></td>
                    <td>{KIND[r.kind] ?? r.kind}{r.description && <><br /><small className="muted break">{r.description}</small></>}</td>
                    <td>{r.requesterName}{r.requesterContact && <><br /><small className="muted break">{r.requesterContact}</small></>}
                      {r.subjectUser && <><br /><small className="muted">račun: {r.subjectUser.displayName}{r.subjectUser.status === 'closed' && ' (zatvoren)'}</small></>}
                      <br /><small className="muted">{r.identityVerifiedOn ? `identitet utvrđen ${date(r.identityVerifiedOn)}` : 'identitet nije utvrđen'}</small></td>
                    <td>{date(r.dueOn)} <DueChip r={r} />
                      {r.extension && <><br /><small className="muted">produljen (osnovni rok {date(r.baseDueOn)}); ispitanik obaviješten {date(r.extension.informedOn)}{r.extension.late && <> – <b>nakon osnovnog roka</b></>}</small></>}</td>
                    <td className="row-actions">
                      <button onClick={() => setForm(r)} aria-label={`Uredi zahtjev ${r.ref}`}>Uredi…</button>
                      {r.extension
                        ? <ActionButton label={`Poništi produljenje roka zahtjeva ${r.ref}`} confirm={`Poništiti produljenje roka zahtjeva ${r.ref}? Rok se vraća na ${date(r.baseDueOn)}.`} onClick={async () => { await api('POST', `/privacy/requests/${r.id}/extend/cancel`, { revision: r.revision }); await done('Produljenje je poništeno'); }}>Poništi produljenje</ActionButton>
                        : <button onClick={() => setExtending(r)} aria-label={`Produlji rok zahtjeva ${r.ref}`}>Produlji rok…</button>}
                      <button className="primary" onClick={() => setClosing(r)} aria-label={`Zatvori zahtjev ${r.ref}`}>Zatvori…</button>
                    </td></tr>
                ))}</tbody></table></div>
            )}
          </div>
          <div className="card"><h2>Zatvoreni zahtjevi</h2>
            {!closed.length ? <p className="muted">Nema zatvorenih zahtjeva.</p> : (
              <div className="scroll"><table className="requests-table"><caption className="sr-only">Zatvoreni zahtjevi ispitanika</caption>
                <thead><tr><th>Oznaka</th><th>Vrsta</th><th>Podnositelj</th><th>Zaprimljen</th><th>Odgovoreno</th><th>Ishod</th><th><span className="sr-only">Radnje</span></th></tr></thead>
                <tbody>{closed.map((r) => (
                  <tr key={r.id}><td><b>{r.ref}</b></td><td>{KIND[r.kind] ?? r.kind}</td><td>{r.requesterName}</td><td>{date(r.receivedOn)}</td>
                    <td>{date(r.closedOn)} {r.state === 'closed_late' ? <Chip s={`nakon roka (${date(r.dueOn)})`} tone="bad" /> : <Chip s="u roku" tone="ok" />}</td>
                    <td>{OUTCOME[r.outcome ?? ''] ?? r.outcome}{r.outcomeNote && <><br /><small className="muted break">{r.outcomeNote}</small></>}</td>
                    <td><ActionButton label={`Ponovno otvori zahtjev ${r.ref}`} confirm={`Ponovno otvoriti zahtjev ${r.ref}? Ishod i dan odgovora se brišu, rok ostaje ${date(r.dueOn)}.`} onClick={async () => { await api('POST', `/privacy/requests/${r.id}/reopen`, { revision: r.revision }); await done('Zahtjev je ponovno otvoren'); }}>Ponovno otvori</ActionButton></td></tr>
                ))}</tbody></table></div>
            )}
            <p className="muted small-note">Zatvoreni zahtjevi brišu se sami po isteku roka „Zatvoreni zahtjevi ispitanika” (kartica Rokovi čuvanja). Revizijski zapis o zahtjevu ne sadrži ime podnositelja ni upisani tekst.</p>
          </div>
          {form && <RequestDialog request={form === 'new' ? null : form} today={l.today} onClose={() => setForm(null)} onDone={(r, created) => done(created ? `Zahtjev ${r.ref} je upisan – rok za odgovor ${date(r.dueOn)}` : `Zahtjev ${r.ref} je spremljen`)} />}
          {extending && <ExtendDialog request={extending} today={l.today} onClose={() => setExtending(null)} onDone={(r) => done(`Rok zahtjeva ${r.ref} produljen je do ${date(r.dueOn)}`)} />}
          {closing && <CloseDialog request={closing} today={l.today} onClose={() => setClosing(null)} onDone={(r) => done(`Zahtjev ${r.ref} je zatvoren`)} />}
        </>
      )}
    </>
  );
}

function RequestDialog({ request, today, onClose, onDone }: { request: SubjectRequest | null; today: string; onClose: () => void; onDone: (r: SubjectRequest, created: boolean) => Promise<void> }) {
  const [f, setF] = useState({
    receivedOn: request?.receivedOn ?? today, kind: request?.kind ?? 'access', channel: request?.channel ?? 'email', requesterName: request?.requesterName ?? '',
    requesterContact: request?.requesterContact ?? '', description: request?.description ?? '', identityVerifiedOn: request?.identityVerifiedOn ?? '', account: request?.subjectUser?.email ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    let subjectUserId: string | null = null;
    const email = f.account.trim().toLowerCase();
    if (email) {
      if (request?.subjectUser && request.subjectUser.email.toLowerCase() === email) subjectUserId = request.subjectUser.id;
      else {
        const found = await api<PrivacyPeople>('GET', `/privacy/people?q=${encodeURIComponent(email)}`);
        const u = found.users.find((x) => x.email.toLowerCase() === email);
        if (!u) throw new Error(`Korisnički račun s e-adresom ${email} ne postoji – provjeri adresu ili polje ostavi prazno`);
        subjectUserId = u.id;
      }
    }
    const body = { receivedOn: f.receivedOn, kind: f.kind, channel: f.channel, requesterName: f.requesterName, requesterContact: f.requesterContact || null, description: f.description || null,
      identityVerifiedOn: f.identityVerifiedOn || null, subjectUserId };
    const r = request ? await api<SubjectRequest>('PUT', `/privacy/requests/${request.id}`, { ...body, revision: request.revision }) : await api<SubjectRequest>('POST', '/privacy/requests', body);
    await onDone(r, !request);
  };
  return (
    <Dialog title={request ? `Zahtjev ${request.ref}` : 'Novi zahtjev ispitanika'} onClose={onClose} className="privacy-dialog wide">
      <ActionForm submit={request ? 'Spremi zahtjev' : 'Upiši zahtjev'} onSubmit={save}>
        <Field label="Dan zaprimanja" hint="Od ovog dana teče rok od mjesec dana."><input type="date" value={f.receivedOn} max={today} min="2018-05-25" onChange={set('receivedOn')} required /></Field>
        <Field label="Na koje se pravo zahtjev odnosi"><select value={f.kind} onChange={set('kind')}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Kako je zaprimljen"><select value={f.channel} onChange={set('channel')}>{Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Podnositelj (ime i prezime)"><input value={f.requesterName} onChange={set('requesterName')} minLength={2} maxLength={200} autoComplete="off" required /></Field>
        <Field label="Kontakt za odgovor (neobvezno)" hint="E-adresa, adresa ili telefon na koji se šalje odgovor."><input value={f.requesterContact} onChange={set('requesterContact')} maxLength={300} autoComplete="off" /></Field>
        <Field label="Sažetak zahtjeva (neobvezno)" hint="Što podnositelj traži. Ne upisuj više osobnih podataka nego što je potrebno."><textarea value={f.description} onChange={set('description')} maxLength={2000} rows={3} /></Field>
        <Field label="Dan utvrđivanja identiteta (neobvezno)" hint="Identitet podnositelja utvrđuje institucija izvan sustava; ovdje se samo bilježi kada."><input type="date" value={f.identityVerifiedOn} min={f.receivedOn} max={today} onChange={set('identityVerifiedOn')} /></Field>
        <Field label="E-adresa korisničkog računa podnositelja (neobvezno)" hint="Ako podnositelj ima račun u sustavu. Povezan zahtjev ulazi u izvoz podataka te osobe; sustav zahtjev ne povezuje sam po imenu."><input type="email" value={f.account} onChange={set('account')} maxLength={254} autoComplete="off" /></Field>
      </ActionForm>
      <div className="actions"><button onClick={onClose}>Odustani</button></div>
    </Dialog>
  );
}

function ExtendDialog({ request: r, today, onClose, onDone }: { request: SubjectRequest; today: string; onClose: () => void; onDone: (r: SubjectRequest) => Promise<void> }) {
  const [informedOn, setInformedOn] = useState(today);
  const [reason, setReason] = useState('');
  const late = informedOn > r.baseDueOn;
  return (
    <Dialog title={`Produljenje roka: ${r.ref}`} onClose={onClose} className="privacy-dialog">
      <p>Rok se produljuje za dva daljnja mjeseca – na <b>tri mjeseca od zaprimanja</b> ({date(r.receivedOn)}). Produljenje je dopušteno kad je to potrebno zbog složenosti i broja zahtjeva, a ispitanik mora biti obaviješten o produljenju i razlozima <b>unutar prvog mjeseca</b> (do {date(r.baseDueOn)}).</p>
      {late && <p className="warnbox">Upisani dan obavijesti je nakon osnovnog roka ({date(r.baseDueOn)}). Sustav će produljenje zabilježiti, ali ga označava kao zakašnjelo.</p>}
      <ActionForm submit="Produlji rok" onSubmit={async () => onDone(await api<SubjectRequest>('POST', `/privacy/requests/${r.id}/extend`, { informedOn, reason, revision: r.revision }))}>
        <Field label="Dan kad je ispitanik obaviješten o produljenju"><input type="date" value={informedOn} min={r.receivedOn} max={today} onChange={(e) => setInformedOn(e.target.value)} required /></Field>
        <Field label="Razlog produljenja (najmanje 10 znakova)"><textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={1000} rows={3} required /></Field>
      </ActionForm>
      <div className="actions"><button onClick={onClose}>Odustani</button></div>
    </Dialog>
  );
}

function CloseDialog({ request: r, today, onClose, onDone }: { request: SubjectRequest; today: string; onClose: () => void; onDone: (r: SubjectRequest) => Promise<void> }) {
  const [closedOn, setClosedOn] = useState(today);
  const [outcome, setOutcome] = useState('fulfilled');
  const [note, setNote] = useState('');
  const needsNote = NOTE_REQUIRED.includes(outcome);
  return (
    <Dialog title={`Zatvaranje zahtjeva: ${r.ref}`} onClose={onClose} className="privacy-dialog">
      <p>{r.requesterName} · {KIND[r.kind] ?? r.kind} · rok za odgovor {date(r.dueOn)}. Upiši dan kad je ispitaniku poslan odgovor i ishod.</p>
      {closedOn > r.dueOn && <p className="warnbox">Dan odgovora je nakon roka ({date(r.dueOn)}) – zahtjev će biti označen kao zatvoren nakon roka.</p>}
      <ActionForm submit="Zatvori zahtjev" onSubmit={async () => onDone(await api<SubjectRequest>('POST', `/privacy/requests/${r.id}/close`, { closedOn, outcome, note: note || null, revision: r.revision }))}>
        <Field label="Dan odgovora ispitaniku"><input type="date" value={closedOn} min={r.receivedOn} max={today} onChange={(e) => setClosedOn(e.target.value)} required /></Field>
        <Field label="Ishod"><select value={outcome} onChange={(e) => setOutcome(e.target.value)}>{Object.entries(OUTCOME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label={needsNote ? 'Obrazloženje (obvezno uz odbijanje ili djelomično udovoljenje)' : 'Napomena (neobvezno)'} hint="Ispitanik ima pravo znati zašto zahtjevu nije udovoljeno i da može podnijeti pritužbu nadzornom tijelu."><textarea value={note} onChange={(e) => setNote(e.target.value)} minLength={needsNote ? 5 : undefined} maxLength={2000} rows={3} required={needsNote} /></Field>
      </ActionForm>
      <div className="actions"><button onClick={onClose}>Odustani</button></div>
    </Dialog>
  );
}
