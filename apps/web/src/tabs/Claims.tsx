import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { centsToInput, date, eur, label, monthLabel, parseEur, plural } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { defaultPeriod, groupExpenses, localToday, type ExpenseGroup } from '../lib/claims';
import type { Claim, ClaimExpense, ChecklistItem, DecisionPreview, PreparationMeasures } from '../lib/types';
import { ActionButton, ActionForm, Chip, ErrorBox, Field, Loading } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';

const DECIDED = ['approved', 'partially_approved', 'rejected'];
const MIN_REASON = 5;

export function ClaimsTab({ project: p, me }: TabProps) {
  const claims = useLoad(() => api<Claim[]>('GET', `/projects/${p.id}/claims`), [p.id]);
  const write = can(me, 'finance:write', p.id) && p.status !== 'contracting';
  const today = localToday();
  const free = p.reportingPeriods.filter((r) => !claims.data?.some((c) => c.period.number === r.number));
  const [period, setPeriod] = useState('');
  if (claims.error) return <ErrorBox error={claims.error} />;
  if (!claims.data) return <Loading what="zahtjeve" />;
  const chosen = period || String(defaultPeriod(free, today) ?? '');
  return (
    <>
      {write && free.length > 0 && (
        <div className="card"><h2>Novi zahtjev za nadoknadu</h2>
          <ActionForm className="form one" submit="Otvori zahtjev" onSubmit={async () => { await api('POST', `/projects/${p.id}/claims`, { period: Number(chosen) }); setPeriod(''); await claims.reload(); }}>
            <Field label="Izvještajno razdoblje" hint="Nacrt se može otvoriti bilo kad; predaja je moguća nakon kraja razdoblja (ranije samo uz obrazloženje).">
              <select value={chosen} onChange={(e) => setPeriod(e.target.value)}>{free.map((r) => <option key={r.number} value={r.number}>RP{r.number} ({date(r.startDate)} – {date(r.endDate)}) · {r.endDate < today ? 'završilo' : 'u tijeku'}</option>)}</select>
            </Field>
          </ActionForm>
        </div>
      )}
      {p.reportingPeriods.length === 0 && <p className="muted">Zahtjevi se otvaraju po izvještajnim razdobljima, koja nastaju aktivacijom projekta.</p>}
      {claims.data.map((c) => <ClaimCard key={c.id} claim={c} projectId={p.id} write={write} reload={claims.reload} />)}
    </>
  );
}

function ClaimCard({ claim: c, projectId, write, reload }: { claim: Claim; projectId: string; write: boolean; reload: () => Promise<void> }) {
  const base = `/projects/${projectId}/claims/${c.id}`;
  const decided = DECIDED.includes(c.status);
  const [correcting, setCorrecting] = useState(false);
  return (
    <div className="card">
      <div className="card-head">
        <h2>ZNS za RP{c.period.number} <Chip s={c.status} /></h2>
        <span className="muted">{date(c.period.startDate)} – {date(c.period.endDate)} · rok {date(c.period.dueDate)}</span>
      </div>
      <Figures c={c} />
      <div className="actions">
        <ActionButton onClick={() => downloadFile(`${base}/export`, `ZNS_RP${c.period.number}.zip`)}>Preuzmi paket za predaju (ZIP)</ActionButton>
        <span className="muted">troškovi (Excel), evidencije rada za potpis, dokazi, kontrolna lista i popis sadržaja{c.status === 'draft' ? ' · nacrt je u svakoj datoteci označen kao NACRT' : ''}</span>
      </div>
      {c.status === 'draft' && c.note && <div className="warnbox">Vraćen na dopunu: {c.note}</div>}
      {c.earlyReason && <div className="warnbox">Predan prije kraja razdoblja. Razlog: {c.earlyReason}</div>}
      {decided && c.note && <div className="warnbox">Napomena uz odluku: {c.note}</div>}
      {c.decision && c.decision.funderTotal !== null && c.decision.difference !== 0 && (
        <div className="warnbox">Iznos iz odluke ({eur(c.decision.funderTotal)}) razlikuje se od izračunatog priznatog iznosa ({eur(c.decision.computed)}) za {eur(c.decision.difference)}.</div>
      )}
      {c.paid !== null && c.approved !== null && c.paid !== c.approved && <div className="warnbox">Isplaćeno {eur(c.paid)} uz odobreno {eur(c.approved)}{c.paymentNote ? ` – ${c.paymentNote}` : ''}.</div>}
      {c.status === 'draft' && c.earlierCandidates && c.earlierCandidates.length > 0 && <EarlierPanel c={c} base={base} write={write} reload={reload} />}
      {c.status === 'draft' && c.checklist && <SubmitPanel c={c} base={base} write={write} reload={reload} />}
      {c.status !== 'draft' && <PreparationPanel c={c} base={base} write={write} reload={reload} />}
      {c.status !== 'draft' && c.submission && (c.submission.warnings.length > 0) && (
        <details className="sub-panel"><summary>Upozorenja zabilježena pri predaji ({c.submission.warnings.length})</summary>
          <ul className="checklist">{c.submission.warnings.map((w) => <li key={w.key}><b>! {w.title}</b>{w.details.length > 0 && <ul>{w.details.map((d) => <li key={d}>{d}</li>)}</ul>}</li>)}</ul>
        </details>
      )}
      <h3>{c.status === 'draft' ? 'Troškovi koji će ući u zahtjev' : 'Troškovi u zahtjevu'} ({c.expenses.length})</h3>
      <ExpenseTable c={c} />
      {write && c.status === 'submitted' && <DecisionForm c={c} base={base} mode="decide" reload={reload} />}
      {write && decided && c.paid === null && (
        <div className="actions">
          {!correcting && <button onClick={() => setCorrecting(true)}>Ispravi odluku</button>}
        </div>
      )}
      {write && decided && c.paid === null && correcting && <DecisionForm c={c} base={base} mode="correct" reload={async () => { setCorrecting(false); await reload(); }} onCancel={() => setCorrecting(false)} />}
      {write && ['approved', 'partially_approved'].includes(c.status) && c.paid === null && !correcting && <PaymentForm c={c} base={base} reload={reload} />}
    </div>
  );
}

function Figures({ c }: { c: Claim }) {
  if (c.recognised && c.unrecognised) {
    return (
      <div className="grid g4">
        <div className="tile"><div className="v">{eur(c.requested)}</div><div className="l">traženo · troškovi {eur(c.totals.total)}</div></div>
        <div className="tile"><div className="v">{eur(c.recognised.requested)}</div><div className="l">priznato · troškovi {eur(c.recognised.total)}</div></div>
        <div className="tile"><div className="v">{eur(c.unrecognised.requested)}</div><div className="l">nepriznato · troškovi {eur(c.unrecognised.total)}</div></div>
        <div className="tile"><div className="v">{eur(c.approved)}</div><div className="l">odobreno {date(c.decisionDate)} · isplaćeno {c.paid === null ? '–' : `${eur(c.paid)} (${date(c.paidAt)})`}</div></div>
      </div>
    );
  }
  return (
    <div className="grid g4">
      <div className="tile"><div className="v">{eur(c.totals.direct)}</div><div className="l">izravni troškovi</div></div>
      <div className="tile"><div className="v">{eur(c.totals.indirect)}</div><div className="l">neizravni (iz paketa)</div></div>
      <div className="tile"><div className="v">{eur(c.totals.requested)}</div><div className="l">traženo ({c.totals.ratePercent} %)</div></div>
      <div className="tile"><div className="v">{c.status === 'draft' ? 'nacrt' : date(c.submittedAt)}</div><div className="l">{c.status === 'draft' ? 'još nije predan' : 'predan · čeka odluku'}</div></div>
    </div>
  );
}

/** Popis za provjeru prije predaje: blokirajuće stavke, upozorenja, razlog rane predaje i potvrda troškova bez dokaza. */
function SubmitPanel({ c, base, write, reload }: { c: Claim; base: string; write: boolean; reload: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [prep, setPrep] = useState(c.preparation.hours === null ? '' : String(c.preparation.hours).replace('.', ','));
  const prepHours = parseHoursInput(prep);
  const items = c.checklist!.items;
  const resolved = (i: ChecklistItem) => i.ok || (i.resolution === 'early_reason' && reason.trim().length >= MIN_REASON) || (i.resolution === 'acknowledge' && ack);
  const open = items.filter((i) => i.severity === 'blocking' && !resolved(i));
  const early = items.find((i) => i.key === 'period_ended' && !i.ok);
  const evidence = items.find((i) => i.key === 'evidence' && !i.ok);
  return (
    <div className="sub-panel" aria-label="Provjera prije predaje">
      <h3 style={{ marginTop: 0 }}>Provjera prije predaje</h3>
      <ul className="checklist">
        {items.map((i) => {
          const r = resolved(i);
          const cls = i.ok && i.severity === 'blocking' ? 'ok' : !r ? 'bad' : '';
          const mark = i.ok ? (i.severity === 'warning' && i.resolution ? '!' : '✓') : r ? '!' : i.severity === 'blocking' ? '✗' : '!';
          return (
            <li key={i.key} className={cls} style={!r || i.ok ? undefined : { color: 'var(--warn)' }}>
              {mark} {i.title}{i.severity === 'warning' && !i.ok && <span className="muted"> (upozorenje)</span>}
              {i.details.length > 0 && <ul className="muted" style={{ margin: '2px 0 4px', paddingLeft: 20 }}>{i.details.map((d) => <li key={d}>{d}</li>)}</ul>}
            </li>
          );
        })}
      </ul>
      {write && early && (
        <Field label="Razlog rane predaje (obavezan – zapisuje se uz zahtjev i u reviziju)">
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="npr. raniji završetak projekta prema aneksu ugovora" />
        </Field>
      )}
      {write && evidence && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8, fontSize: 14 }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>Potvrđujem predaju {evidence.expenseIds?.length ?? 0} {plural(evidence.expenseIds?.length ?? 0, 'troška', 'troška', 'troškova')} bez priloženog dokaza (zapisuje se u reviziju). Dokaz se nakon predaje više ne može priložiti.</span>
        </label>
      )}
      {write && (
        <Field label="Sati utrošeni na pripremu ovog zahtjeva (neobavezno)" hint="Ukupno vrijeme svih koji su radili na zahtjevu (prikupljanje računa, tablice, evidencije, provjera). Ulazi u izvještaj „Ušteda na ZNS-u” na portfelju.">
          <input aria-label="Sati utrošeni na pripremu" inputMode="decimal" value={prep} onChange={(e) => setPrep(e.target.value)} placeholder="npr. 12,5" style={prepHours === undefined ? { borderColor: 'var(--bad)' } : undefined} />
        </Field>
      )}
      {write && (
        <div className="actions">
          <ActionButton kind="primary" disabled={open.length > 0 || prepHours === undefined} confirm="Predati zahtjev? Troškovi, timesheetovi i dokazi se zaključavaju."
            onClick={async () => { await api('POST', `${base}/submit`, { ...(early ? { earlyReason: reason.trim() } : {}), ...(evidence && ack ? { acknowledgeWithoutEvidence: evidence.expenseIds ?? [] } : {}), ...(prepHours !== null && prepHours !== undefined ? { preparationHours: prepHours } : {}) }); await reload(); }}>
            Predaj zahtjev
          </ActionButton>
          {open.length > 0 && <span className="muted">Predaja nije moguća: {open.length} {plural(open.length, 'otvorena stavka', 'otvorene stavke', 'otvorenih stavki')}.</span>}
        </div>
      )}
    </div>
  );
}

/** Sati u obliku "12,5": prazno → null (nije upisano), neispravno → undefined. */
function parseHoursInput(v: string): number | null | undefined {
  const t = v.trim().replace(',', '.');
  if (!t) return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return undefined;
  return Number(t);
}

/**
 * WP1.16b: nepredani troškovi iz ranijih razdoblja (datirani u razdoblju čiji je ZNS već predan). Ne ulaze sami –
 * priprematelj ih izričito odabire; tada su u zahtjevu i paketu označeni kao „ranije razdoblje”.
 */
function EarlierPanel({ c, base, write, reload }: { c: Claim; base: string; write: boolean; reload: () => Promise<void> }) {
  const list = c.earlierCandidates!;
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(list.filter((x) => x.selected).map((x) => x.id)));
  const saved = new Set(list.filter((x) => x.selected).map((x) => x.id));
  const dirty = chosen.size !== saved.size || [...chosen].some((id) => !saved.has(id));
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="sub-panel" aria-label="Troškovi iz ranijih razdoblja">
      <h3 style={{ marginTop: 0 }}>Troškovi iz ranijih razdoblja ({list.length})</h3>
      <p className="muted" style={{ marginTop: 0 }}>Evidentirani nakon što je ZNS za njihovo razdoblje već predan, pa nisu ni u jednom zahtjevu. Ulaze u ovaj zahtjev samo ako ih izričito odabereš; u zahtjevu i paketu za predaju označeni su kao „ranije razdoblje”.</p>
      <table className="claim-table">
        <thead><tr><th /><th>Datum</th><th>Trošak</th><th className="num">Iznos</th><th>Dokaz</th></tr></thead>
        <tbody>{list.map((x) => (
          <tr key={x.id}>
            <td><input type="checkbox" aria-label={`Uključi: ${x.description}`} checked={chosen.has(x.id)} disabled={!write || x.selectedElsewhere !== null} onChange={() => toggle(x.id)} /></td>
            <td>{date(x.date)}<small className="muted">RP{x.period ?? '?'}</small></td>
            <td>{x.categoryCode} · {x.description}{x.supplier ? <span className="muted"> · {x.supplier}</span> : null}{x.selectedElsewhere !== null && <small className="muted">već odabran u nacrtu ZNS-a za RP{x.selectedElsewhere}</small>}</td>
            <td className="num">{eur(x.amount)}</td>
            <td>{x.source !== 'manual' ? <span className="muted">timesheet</span> : x.documents ? `dokaz (${x.documents})` : <span className="chip warn">bez dokaza</span>}</td>
          </tr>
        ))}</tbody>
      </table>
      {write && (
        <div className="actions">
          <ActionButton kind={dirty ? 'primary' : undefined} disabled={!dirty} onClick={async () => { await api('PUT', `${base}/earlier-expenses`, { expenseIds: [...chosen] }); await reload(); }}>Spremi odabir</ActionButton>
          <span className="muted">Odabrano: {chosen.size} od {list.length}</span>
        </div>
      )}
    </div>
  );
}

const MEASURE_ROWS: [keyof PreparationMeasures, string][] = [
  ['daysAfterPeriodEnd', 'dana od kraja razdoblja do predaje'], ['daysInPreparation', 'dana od otvaranja nacrta do predaje'], ['returns', 'povrata na dopunu'],
  ['expenses', 'troškova'], ['evidenceFiles', 'dokaza'], ['timesheets', 'timesheetova'],
];

/** WP1.16b: mjerenje pripreme nakon predaje – automatske mjere i prijavljeni sati (naknadni upis ili ispravak). */
function PreparationPanel({ c, base, write, reload }: { c: Claim; base: string; write: boolean; reload: () => Promise<void> }) {
  const m = c.preparation.measures;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(c.preparation.hours === null ? '' : String(c.preparation.hours).replace('.', ','));
  const parsed = parseHoursInput(value);
  if (!m) return null;
  return (
    <details className="sub-panel" aria-label="Mjerenje pripreme">
      <summary>Mjerenje pripreme · {c.preparation.hours === null ? 'sati pripreme nisu upisani' : `${String(c.preparation.hours).replace('.', ',')} h pripreme`} · predan {m.daysAfterPeriodEnd >= 0 ? `${m.daysAfterPeriodEnd} d nakon kraja razdoblja` : `${-m.daysAfterPeriodEnd} d prije kraja razdoblja`}</summary>
      <div className="chips" style={{ marginTop: 8 }}>{MEASURE_ROWS.map(([k, l]) => <span key={k} className="chip"><b>{m[k]}</b> {l}</span>)}{m.earlierExpenses > 0 && <span className="chip acc"><b>{m.earlierExpenses}</b> iz ranijih razdoblja</span>}</div>
      <p className="muted">Mjeri se automatski iz vremena otvaranja i predaje i revizijskog zapisa. Sustav ne zna koliko ste sati radili – to upisuje priprematelj (ulazi u izvještaj „Ušteda na ZNS-u” na portfelju).</p>
      {write && !editing && <button onClick={() => setEditing(true)}>{c.preparation.hours === null ? 'Upiši sate pripreme' : 'Ispravi sate pripreme'}</button>}
      {write && editing && (
        <div className="actions">
          <Field label="Sati utrošeni na pripremu"><input aria-label="Sati pripreme" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          <ActionButton kind="primary" disabled={parsed === undefined} onClick={async () => { await api('PUT', `${base}/preparation-hours`, { hours: parsed }); setEditing(false); await reload(); }}>Spremi</ActionButton>
          <button onClick={() => setEditing(false)}>Odustani</button>
        </div>
      )}
    </details>
  );
}

const statusOf = (rows: ClaimExpense[]): string | null => (rows.every((r) => r.status === rows[0]!.status) ? rows[0]!.status : null);

function ExpenseTable({ c }: { c: Claim }) {
  const groups = useMemo(() => groupExpenses(c.expenses), [c.expenses]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const decided = DECIDED.includes(c.status);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const cols = decided ? 6 : 5;
  return (
    <div className="scroll">
      <table className="claim-table">
        <thead><tr><th>Datum</th><th>Trošak</th><th className="num">Traženo</th>{decided && <th className="num">Priznato</th>}<th>Status</th><th>Dokaz</th></tr></thead>
        <tbody>
          {groups.map((g) => g.kind === 'personnel' ? (
            <Fragment key={g.key}>
              <tr>
                <td>{date(g.date)}{g.rows.some((e) => e.earlier) && <><br /><span className="chip acc">ranije razdoblje</span></>}</td>
                <td><button className="link" aria-expanded={open.has(g.key)} onClick={() => toggle(g.key)}>{open.has(g.key) ? '▾' : '▸'} Rad: {g.person}, {g.month ? monthLabel(g.month) : ''}</button> <span className="muted">· {g.rows.length} {plural(g.rows.length, 'radni paket', 'radna paketa', 'radnih paketa')}</span></td>
                <td className="num">{eur(g.amount)}</td>{decided && <td className="num">{eur(g.recognised)}</td>}
                <td>{statusOf(g.rows) ? <Chip s={statusOf(g.rows)!} /> : <span className="chip warn">djelomično</span>}</td>
                <td className="muted">timesheet</td>
              </tr>
              {open.has(g.key) && g.rows.map((e) => (
                <tr key={e.id} className="sub-row">
                  <td />
                  <td style={{ paddingLeft: 28 }}>{e.workPackage ?? 'bez radnog paketa'} <span className="muted">· {e.description.replace(/^Rad: [^,]*, \d{4}-\d{2} /, '')}</span>{e.decisionReason && <small className="muted">Razlog: {e.decisionReason}</small>}</td>
                  <td className="num">{eur(e.amount)}</td>{decided && <td className="num">{eur(e.recognised)}</td>}
                  <td><Chip s={e.status} /></td><td />
                </tr>
              ))}
            </Fragment>
          ) : g.rows.map((e) => (
            <tr key={e.id}>
              <td>{date(e.date)}{e.earlier && <><br /><span className="chip acc" title="trošak iz ranijeg razdoblja, izričito uključen">ranije razdoblje</span></>}</td>
              <td>{e.categoryCode} · {e.description}{e.supplier ? <span className="muted"> · {e.supplier}</span> : null}{e.decisionReason && <small className="muted">Razlog: {e.decisionReason}</small>}</td>
              <td className="num">{eur(e.amount)}</td>{decided && <td className="num">{eur(e.recognised)}</td>}
              <td><Chip s={e.status} /></td>
              <td>{e.documents ? `dokaz (${e.documents})` : <span className="chip warn">bez dokaza</span>}</td>
            </tr>
          )))}
          {c.expenses.length === 0 && <tr><td colSpan={cols} className="muted">Nema troškova u razdoblju.</td></tr>}
        </tbody>
        {c.expenses.length > 0 && (
          <tfoot><tr><td colSpan={2}>Izravni troškovi</td><td className="num">{eur(c.totals.direct)}</td>{decided && <td className="num">{eur(c.recognised?.direct)}</td>}<td colSpan={2} /></tr></tfoot>
        )}
      </table>
    </div>
  );
}

type Row = { recognised: string; reason: string };

/** Odluka (ili ispravak odluke) po trošku: priznati iznos i razlog; izračun priznatog iznosa s poslužitelja uz iznos financijera. */
function DecisionForm({ c, base, mode, reload, onCancel }: { c: Claim; base: string; mode: 'decide' | 'correct'; reload: () => Promise<void>; onCancel?: () => void }) {
  const today = localToday();
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(c.expenses.map((e) => [e.id, { recognised: centsToInput(e.recognised ?? e.amount) || '0', reason: e.decisionReason ?? '' }])));
  const [decisionDate, setDecisionDate] = useState(mode === 'correct' ? (c.decisionDate ?? today) : today);
  const [funder, setFunder] = useState(mode === 'correct' && c.decision?.funderTotal != null ? centsToInput(c.decision.funderTotal) : '');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<DecisionPreview | null>(null);
  const groups = useMemo(() => groupExpenses(c.expenses), [c.expenses]);
  const byId = useMemo(() => new Map(c.expenses.map((e) => [e.id, e])), [c.expenses]);
  const parsed = (id: string): number | null => parseEur(rows[id]?.recognised ?? '');
  const funderCents = funder.trim() ? parseEur(funder) : null;
  const payload = () => {
    const expenses = c.expenses.flatMap((e) => {
      const v = parsed(e.id); if (v === null) return [];
      const current = e.recognised ?? e.amount; const reason = rows[e.id]!.reason.trim();
      if (mode === 'decide' ? v === e.amount : v === current && reason === (e.decisionReason ?? '')) return [];
      return [{ id: e.id, recognised: v, ...(v < e.amount ? { reason } : {}) }];
    });
    return { decisionDate, expenses, ...(funderCents !== null ? { funderTotal: funderCents } : mode === 'correct' ? { funderTotal: null } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
  };
  const key = JSON.stringify(payload());
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => { api<DecisionPreview>('POST', `${base}/decision/preview`, JSON.parse(key)).then((p) => { if (live) setPreview(p); }).catch(() => undefined); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [key, base]);
  const set = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id]!, ...patch } }));
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const rowInputs = (e: ClaimExpense) => {
    const v = parsed(e.id);
    const reduced = v !== null && v < e.amount;
    return (
      <>
        <td className="num">{eur(e.amount)}</td>
        <td><input className="cell" aria-label={`Priznato: ${e.description}`} inputMode="decimal" value={rows[e.id]!.recognised} onChange={(ev) => set(e.id, { recognised: ev.target.value })} style={v === null || (v ?? 0) > e.amount ? { borderColor: 'var(--bad)' } : undefined} />
          {' '}<button type="button" className="link" onClick={() => set(e.id, { recognised: reduced ? centsToInput(e.amount) : '0' })}>{reduced ? 'cijeli' : 'odbij'}</button></td>
        <td><input aria-label={`Razlog: ${e.description}`} value={rows[e.id]!.reason} onChange={(ev) => set(e.id, { reason: ev.target.value })} placeholder={reduced ? 'razlog (obavezno)' : ''} disabled={!reduced} style={reduced && rows[e.id]!.reason.trim().length < MIN_REASON ? { borderColor: 'var(--warn)' } : undefined} /></td>
      </>
    );
  };
  const groupRecognised = (g: ExpenseGroup<ClaimExpense>) => g.rows.reduce((a, e) => a + (parsed(e.id) ?? 0), 0);
  return (
    <div className="sub-panel">
      <h3 style={{ marginTop: 0 }}>{mode === 'decide' ? 'Odluka o zahtjevu' : 'Ispravak odluke'}</h3>
      <p className="muted" style={{ marginTop: 0 }}>Priznati iznos po trošku (zadano cijeli). Kod umanjenja ili odbijanja razlog je obavezan. Priznati ukupni iznos računa se istim pravilima kao zahtjev (izravni → neizravni → stopa financiranja).</p>
      <div className="scroll">
        <table className="claim-table">
          <thead><tr><th>Trošak</th><th className="num">Traženo</th><th>Priznato (€)</th><th>Razlog</th></tr></thead>
          <tbody>
            {groups.map((g) => g.kind === 'personnel' ? (
              <Fragment key={g.key}>
                <tr><td><button type="button" className="link" aria-expanded={open.has(g.key)} onClick={() => toggle(g.key)}>{open.has(g.key) ? '▾' : '▸'} Rad: {g.person}, {g.month ? monthLabel(g.month) : ''}</button></td>
                  <td className="num">{eur(g.amount)}</td><td className="num-inline">{eur(groupRecognised(g))}</td><td className="muted">{open.has(g.key) ? '' : 'otvori za odluku po radnom paketu'}</td></tr>
                {open.has(g.key) && g.rows.map((e) => <tr key={e.id}><td style={{ paddingLeft: 28 }}>{e.workPackage ?? 'bez radnog paketa'}</td>{rowInputs(e)}</tr>)}
              </Fragment>
            ) : g.rows.map((e) => <tr key={e.id}><td>{e.categoryCode} · {e.description}</td>{rowInputs(e)}</tr>))}
          </tbody>
        </table>
      </div>
      <div className="form" style={{ marginTop: 10 }}>
        <Field label="Datum odluke"><input type="date" value={decisionDate} max={today} onChange={(e) => setDecisionDate(e.target.value)} /></Field>
        <Field label="Iznos iz odluke financijera (€)" hint="neobavezno – ako se razlikuje od izračunatog, upiši napomenu"><input inputMode="decimal" value={funder} onChange={(e) => setFunder(e.target.value)} /></Field>
        <Field label={mode === 'correct' ? 'Razlog ispravka (obavezno)' : 'Napomena uz odluku'}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      {preview && (
        <div className="grid g4" style={{ marginTop: 10 }} aria-live="polite">
          <div className="tile"><div className="v">{eur(c.requested)}</div><div className="l">traženo</div></div>
          <div className="tile"><div className="v">{eur(preview.computed)}</div><div className="l">priznato (izračun)</div></div>
          <div className="tile"><div className="v">{eur(preview.unrecognised.requested)}</div><div className="l">nepriznato</div></div>
          <div className="tile"><div className="v">{eur(preview.approved)}</div><div className="l">odobreno · ishod: {label(preview.outcome)}{preview.funderTotal !== null && preview.difference !== 0 ? ` · razlika ${eur(preview.difference)}` : ''}</div></div>
        </div>
      )}
      {preview && preview.errors.length > 0 && <div className="warnbox"><b>Prije spremanja:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{preview.errors.map((e) => <li key={e}>{e.replace(/trošak [0-9a-f-]{36}/, (m) => { const d = byId.get(m.slice(7)); return d ? `„${d.description}”` : m; })}</li>)}</ul></div>}
      <div className="actions">
        <ActionButton kind="primary" disabled={!!preview?.errors.length || (mode === 'correct' && note.trim().length < MIN_REASON)} confirm={mode === 'decide' ? 'Spremiti odluku? Priznati iznosi postaju nepromjenjivi.' : 'Spremiti ispravak odluke? Promjena se zapisuje u reviziju.'}
          onClick={async () => { await api('POST', mode === 'decide' ? `${base}/decision` : `${base}/decision/correction`, { ...(mode === 'decide' ? { decision: 'decided' } : {}), ...payload() }); await reload(); }}>
          {mode === 'decide' ? 'Spremi odluku' : 'Spremi ispravak'}
        </ActionButton>
        {mode === 'decide' && (
          <ActionButton onClick={async () => { const r = window.prompt('Razlog povrata na dopunu'); if (!r) return; await api('POST', `${base}/decision`, { decision: 'returned', note: r }); await reload(); }}>Vraćen na dopunu</ActionButton>
        )}
        {onCancel && <button type="button" onClick={onCancel}>Odustani</button>}
      </div>
    </div>
  );
}

function PaymentForm({ c, base, reload }: { c: Claim; base: string; reload: () => Promise<void> }) {
  const today = localToday();
  const [amount, setAmount] = useState(centsToInput(c.approved ?? 0));
  const [at, setAt] = useState(today);
  const [note, setNote] = useState('');
  const cents = parseEur(amount);
  const diff = cents === null ? 0 : cents - (c.approved ?? 0);
  const minDate = c.decisionDate ?? undefined;
  const dateIssue = minDate && at < minDate ? `datum isplate je prije odluke (${date(minDate)})` : at > today ? 'datum isplate je u budućnosti' : null;
  return (
    <div className="sub-panel">
      <h3 style={{ marginTop: 0 }}>Isplata</h3>
      <div className="form">
        <Field label="Isplaćeni iznos (€)" hint={`odobreno ${eur(c.approved)}`}><input aria-label="Isplaćeni iznos" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Datum isplate" hint={minDate ? `od ${date(minDate)} do danas` : undefined}><input aria-label="Datum isplate" type="date" value={at} min={minDate} max={today} onChange={(e) => setAt(e.target.value)} /></Field>
        {diff !== 0 && <Field label={`Napomena uz razliku (${eur(diff)}) – obavezno`}><input aria-label="Napomena uz isplatu" value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
      </div>
      {dateIssue && <div className="warnbox">{dateIssue}</div>}
      <div className="actions">
        <ActionButton disabled={cents === null || !!dateIssue || (diff !== 0 && note.trim().length < MIN_REASON)} onClick={async () => { await api('POST', `${base}/payment`, { paidAmount: cents, paidAt: at, ...(note.trim() ? { note: note.trim() } : {}) }); await reload(); }}>Zabilježi isplatu</ActionButton>
      </div>
    </div>
  );
}
