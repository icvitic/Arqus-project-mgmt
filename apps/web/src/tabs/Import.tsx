import { useRef, useState } from 'react';
import { api, downloadFile, upload } from '../lib/api';
import { dateTime, plural } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { ActionButton, ErrorBox, Loading } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';

/**
 * WP1.17 – uvoz postojećeg projekta iz Excela: predložak za ovaj projekt → učitavanje → pregled (ništa se ne sprema) →
 * potvrda istih bajtova → rezultat s poveznicama → povijest s poništavanjem. Greške su prve, po listu, retku i stupcu.
 */
type SheetKey = 'workPackages' | 'deliverables' | 'milestones' | 'budget' | 'team' | 'expenses';
interface Issue { sheet: string; row: number | null; column: string | null; value: string | null; message: string }
interface SheetPlan {
  key: SheetKey; label: string; name: string | null; permission: string; status: 'ready' | 'empty' | 'skipped' | 'rejected' | 'absent'; reason: string | null;
  rowsRead: number; rowsValid: number; created: number; updated: number; unchanged: number; errors: Issue[]; warnings: Issue[];
  items: { row: number; action: 'create' | 'update' | 'unchanged'; text: string; historic?: boolean }[];
}
interface Plan {
  fileName: string; sha256: string; size: number; format: 'xlsx' | 'csv'; projectRevision: number; fingerprint: string; sheets: SheetPlan[];
  ignoredSheets: string[]; fileWarnings: string[]; errors: number; warnings: number; canConfirm: boolean; needsAcknowledge: boolean;
}
interface Result { importId: string; counts: Record<string, { created: number; updated: number; unchanged: number; rows: number }>; links: { sheet: SheetKey; label: string; tab: string }[] }
interface HistoryRow {
  id: string; fileName: string; sha256: string; size: number; format: string; status: 'applied' | 'undone'; counts: Record<string, { created: number; updated: number; unchanged: number; rows: number }>;
  createdAt: string; createdBy: string | null; undoneAt: string | null; undoneBy: string | null; blockers: string[]; canUndo: boolean; missingPermissions: string[];
}

const SHEET_LABEL: Record<SheetKey, string> = { workPackages: 'Radni paketi', deliverables: 'Isporuke', milestones: 'Prekretnice', budget: 'Proračun', team: 'Tim', expenses: 'Troškovi' };
const STATUS: Record<SheetPlan['status'], [string, string]> = {
  ready: ['spreman', 'ok'], empty: ['prazan – preskače se', ''], skipped: ['izostavljen', 'warn'], rejected: ['ima greške', 'bad'], absent: ['nema lista', ''],
};
const ACTION: Record<string, string> = { create: 'novo', update: 'zamjena', unchanged: 'već postoji' };
const MAX_MB = 5;

/** Kratki sažetak brojeva po listu („3 nova, 2 već postoje”). */
function counts(c: { created: number; updated: number; unchanged: number }): string {
  const parts: string[] = [];
  if (c.created) parts.push(`${c.created} ${plural(c.created, 'novi', 'nova', 'novih')}`);
  if (c.updated) parts.push(`${c.updated} ${plural(c.updated, 'zamjena', 'zamjene', 'zamjena')}`);
  if (c.unchanged) parts.push(`${c.unchanged} već ${plural(c.unchanged, 'postoji', 'postoje', 'postoji')}`);
  return parts.join(', ') || 'ništa novo';
}

/** Brojevi po listu redoslijedom listova predloška. */
const ordered = <T,>(c: Record<string, T>): [SheetKey, T][] => (Object.keys(SHEET_LABEL) as SheetKey[]).filter((k) => c[k]).map((k) => [k, c[k]!]);

export function ImportTab({ project: p, me, reloadProject }: TabProps) {
  const history = useLoad(() => api<HistoryRow[]>('GET', `/projects/${p.id}/imports`), [p.id]);
  const [file, setFile] = useState<File | null>(null);
  const [csvSheet, setCsvSheet] = useState<SheetKey | ''>('');
  const [skip, setSkip] = useState<SheetKey[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'confirm' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Result | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const isCsv = !!file && /\.csv$/i.test(file.name);
  const editable = !['closed', 'terminated', 'archived'].includes(p.status);
  const mayImport = editable && (can(me, 'projects:write', p.id) || can(me, 'finance:write', p.id));

  const form = (extra: Record<string, string> = {}, skipList = skip) => {
    const f = new FormData();
    f.append('file', file!);
    if (skipList.length) f.append('skip', skipList.join(','));
    if (isCsv && csvSheet) f.append('csvSheet', csvSheet);
    for (const [k, v] of Object.entries(extra)) f.append(k, v);
    return f;
  };
  const check = async (skipList = skip) => {
    if (!file) return;
    setBusy('preview'); setError(null); setResult(null); setAck(false);
    try { setPlan(await upload<Plan>(`/projects/${p.id}/import/preview`, form({}, skipList), `${MAX_MB} MB`)); } catch (e) { setPlan(null); setError(e); } finally { setBusy(null); }
  };
  const toggleSkip = async (key: SheetKey) => {
    const next = skip.includes(key) ? skip.filter((k) => k !== key) : [...skip, key];
    setSkip(next); await check(next);
  };
  const confirm = async () => {
    if (!plan || !file) return;
    setBusy('confirm'); setError(null);
    try {
      const r = await upload<Result>(`/projects/${p.id}/import/confirm`, form({ sha256: plan.sha256, revision: String(plan.projectRevision), fingerprint: plan.fingerprint, acknowledgeWarnings: String(ack) }), `${MAX_MB} MB`);
      setResult(r); setPlan(null); setFile(null); setSkip([]); if (input.current) input.current.value = '';
      await reloadProject(); await history.reload();
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const reset = () => { setPlan(null); setFile(null); setSkip([]); setAck(false); setError(null); if (input.current) input.current.value = ''; };

  const withErrors = plan?.sheets.filter((s) => s.errors.length) ?? [];
  const shown = plan?.sheets.filter((s) => s.status !== 'absent') ?? [];

  return (
    <>
      <div className="card import-intro">
        <h2>Uvoz postojećeg projekta iz Excela</h2>
        <p>Projekt koji je već u tijeku unosi se iz tablice: radni paketi, isporuke i prekretnice, proračun, tim i troškovi – i troškovi koji su već bili u zahtjevima za nadoknadu predanima prije ArQusa. Ništa se ne sprema dok ne pregledaš i ne potvrdiš.</p>
        <ol className="stepper" aria-label="Koraci uvoza">
          <li className={file || plan || result ? 'done' : 'cur'}>1. Predložak</li>
          <li className={plan || result ? 'done' : file ? 'cur' : ''}>2. Datoteka</li>
          <li className={plan && !result ? 'cur' : result ? 'done' : ''}>3. Pregled</li>
          <li className={result ? 'done' : ''}>4. Potvrda</li>
        </ol>
        {!mayImport ? <p className="muted">{editable ? 'Uvoz traži pravo uređivanja strukture ili financija na ovom projektu.' : `Projekt je u statusu „${p.status}” – uvoz nije moguć.`}</p> : (
          <div className="import-actions">
            <ActionButton onClick={() => downloadFile(`/projects/${p.id}/import/template`, `Uvoz_${p.acronym}_predlozak.xlsx`)}>Preuzmi predložak za ovaj projekt</ActionButton>
            <label className="field import-file"><span>Ispunjena datoteka (.xlsx ili .csv, do {MAX_MB} MB)</span>
              <input ref={input} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPlan(null); setResult(null); setSkip([]); setError(null); }} />
            </label>
            {isCsv && <label className="field"><span>List u CSV datoteci</span>
              <select value={csvSheet} onChange={(e) => setCsvSheet(e.target.value as SheetKey | '')}><option value="">prepoznaj po nazivu i stupcima</option>{(Object.keys(SHEET_LABEL) as SheetKey[]).map((k) => <option key={k} value={k}>{SHEET_LABEL[k]}</option>)}</select></label>}
            <button className="primary" disabled={!file || busy !== null} onClick={() => check()}>{busy === 'preview' ? 'Provjeravam…' : 'Provjeri datoteku'}</button>
          </div>
        )}
        <ErrorBox error={error} />
      </div>

      {result && (
        <div className="card import-result" role="status">
          <h2>Uvoz je spremljen</h2>
          <ul>{ordered(result.counts).map(([k, c]) => <li key={k}><b>{SHEET_LABEL[k]}:</b> {counts(c)}</li>)}</ul>
          <div className="actions">{result.links.filter((l, i, a) => a.findIndex((x) => x.tab === l.tab) === i).map((l) => <a key={l.tab} className="chip" href={`#/projekti/${p.id}/${l.tab}`}>Otvori: {l.tab === 'struktura' ? 'Struktura rada' : l.tab === 'proracun' ? 'Proračun' : l.tab === 'tim' ? 'Tim i timesheetovi' : 'Troškovi'} →</a>)}
            <a className="chip" href={`#/projekti/${p.id}/financije`}>Ugovoreno / ostvareno →</a></div>
          <p className="muted">Uvoz je zapisan u povijest ispod i u revizijski zapis. Dok na uvezenim podacima ništa nije izgrađeno, može se poništiti.</p>
        </div>
      )}

      {plan && (
        <div className="card import-preview">
          <div className={`import-banner ${plan.errors ? 'bad' : plan.warnings ? 'warn' : 'ok'}`} role="status">
            <b>Ništa još nije spremljeno.</b> {plan.fileName} · {(plan.size / 1024).toLocaleString('hr-HR', { maximumFractionDigits: 0 })} KB · SHA-256 {plan.sha256.slice(0, 12)}…
            <div>{plan.errors ? <span className="bad-text">{plan.errors} {plural(plan.errors, 'greška', 'greške', 'grešaka')} – ispravi datoteku i učitaj je ponovno, ili izostavi list.</span>
              : plan.canConfirm ? <span>Datoteka je valjana{plan.warnings ? `, uz ${plan.warnings} ${plural(plan.warnings, 'upozorenje', 'upozorenja', 'upozorenja')}` : ''}. Pregledaj što će se stvoriti i potvrdi.</span>
              : <span>U datoteci nema ničega novog za uvoz.</span>}</div>
          </div>
          {plan.fileWarnings.length > 0 && <ul className="import-notes">{plan.fileWarnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          {plan.ignoredSheets.length > 0 && <p className="muted">Zanemareni listovi (nisu listovi predloška): {plan.ignoredSheets.join(', ')}.</p>}

          {withErrors.length > 0 && (
            <section aria-labelledby="import-errors">
              <h3 id="import-errors">Greške</h3>
              {withErrors.map((s) => (
                <div key={s.key} className="import-sheet bad">
                  <div className="card-head"><h4>List „{s.name ?? s.label}” – {s.errors.length} {plural(s.errors.length, 'greška', 'greške', 'grešaka')}</h4>
                    <button onClick={() => toggleSkip(s.key)} disabled={busy !== null}>Izostavi ovaj list</button></div>
                  <table className="issue-table"><thead><tr><th>Redak</th><th>Stupac</th><th>Vrijednost</th><th>Što ispraviti</th></tr></thead>
                    <tbody>{s.errors.slice(0, 200).map((e, i) => <tr key={i}><td data-l="Redak">{e.row ?? 'list'}</td><td data-l="Stupac">{e.column ?? '–'}</td><td data-l="Vrijednost" className="break">{e.value ?? '–'}</td><td data-l="Što ispraviti">{e.message}</td></tr>)}</tbody></table>
                  {s.errors.length > 200 && <p className="muted">… i još {s.errors.length - 200}. Ispravi prve pa provjeri ponovno.</p>}
                </div>
              ))}
            </section>
          )}

          <h3>Listovi</h3>
          <div className="import-sheets">
            {shown.map((s) => (
              <div key={s.key} className={`import-sheet ${STATUS[s.status][1]}`}>
                <div className="card-head">
                  <h4>{s.label}{s.name && s.name !== s.label ? <span className="muted"> („{s.name}”)</span> : null} <span className={`chip ${STATUS[s.status][1]}`}>{STATUS[s.status][0]}</span></h4>
                  {(s.status === 'ready' || s.status === 'skipped') && <button className="link" onClick={() => toggleSkip(s.key)} disabled={busy !== null}>{s.status === 'skipped' ? 'Vrati list u uvoz' : 'Izostavi list'}</button>}
                </div>
                <p className="import-counts">{s.status === 'ready' ? `${s.rowsRead} ${plural(s.rowsRead, 'redak', 'retka', 'redaka')} · ${counts(s)}` : s.reason ?? (s.status === 'rejected' ? `valjanih redaka: ${s.rowsValid} od ${s.rowsRead}` : '')}</p>
                {s.warnings.length > 0 && <ul className="import-warnings">{s.warnings.map((w, i) => <li key={i}>{w.row ? <b>redak {w.row}: </b> : null}{w.message}</li>)}</ul>}
                {s.status === 'ready' && s.items.length > 0 && (
                  <details><summary>Što će se dogoditi ({s.items.length})</summary>
                    <ul className="import-items">{s.items.slice(0, 300).map((it, i) => <li key={i}><span className={`chip ${it.action === 'create' ? 'ok' : it.action === 'update' ? 'warn' : ''}`}>{ACTION[it.action]}</span> <span className="muted">r. {it.row}</span> {it.text}{it.historic && <span className="chip warn historic">potraživano prije ArQusa</span>}</li>)}</ul>
                    {s.items.length > 300 && <p className="muted">… i još {s.items.length - 300}.</p>}
                  </details>
                )}
              </div>
            ))}
          </div>

          {plan.canConfirm && plan.needsAcknowledge && (
            <label className="import-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Pročitao/la sam {plan.warnings} {plural(plan.warnings, 'upozorenje', 'upozorenja', 'upozorenja')} i želim nastaviti.</label>
          )}
          <div className="actions">
            <button className="primary" disabled={!plan.canConfirm || (plan.needsAcknowledge && !ack) || busy !== null} onClick={confirm}>{busy === 'confirm' ? 'Spremam…' : 'Potvrdi uvoz'}</button>
            <button onClick={reset} disabled={busy !== null}>Odustani</button>
            {plan.canConfirm && <span className="muted">Potvrda primjenjuje sve ili ništa, upravo ovu datoteku (SHA-256) i samo ako se projekt u međuvremenu nije promijenio.</span>}
          </div>
        </div>
      )}

      <div className="card scroll">
        <h2>Povijest uvoza</h2>
        <ErrorBox error={history.error} />
        {!history.data ? <Loading /> : history.data.length === 0 ? <p className="muted">Na ovom projektu još nije bilo uvoza.</p> : (
          <table className="import-history">
            <thead><tr><th>Kada</th><th>Tko</th><th>Datoteka</th><th>Što je uvezeno</th><th>Status</th><th><span className="sr-only">Radnje</span></th></tr></thead>
            <tbody>{history.data.map((h) => (
              <tr key={h.id}>
                <td data-l="Kada">{dateTime(h.createdAt)}</td><td data-l="Tko">{h.createdBy ?? '–'}</td>
                <td data-l="Datoteka" className="break">{h.fileName}<small className="muted">SHA-256 {h.sha256.slice(0, 12)}…</small></td>
                <td data-l="Uvezeno">{ordered(h.counts).map(([k, c]) => <div key={k}>{SHEET_LABEL[k]}: {counts(c)}</div>)}</td>
                <td data-l="Status">{h.status === 'applied' ? <span className="chip ok">primijenjen</span> : <span className="chip">poništen</span>}{h.undoneAt && <small className="muted">{dateTime(h.undoneAt)}{h.undoneBy ? `, ${h.undoneBy}` : ''}</small>}</td>
                <td data-l="">{h.status === 'applied' && mayImport && (h.canUndo
                  ? <ActionButton kind="danger" confirm={`Poništiti uvoz „${h.fileName}”? Uklanja se sve što je ovaj uvoz stvorio (prijašnji nacrt proračuna se vraća).`} onClick={async () => { await api('POST', `/projects/${p.id}/imports/${h.id}/undo`); await history.reload(); await reloadProject(); }}>Poništi</ActionButton>
                  : <details className="blockers"><summary>Ne može se poništiti</summary><ul>{[...h.blockers, ...h.missingPermissions.map((x) => `poništavanje traži dozvolu ${x}`)].map((b) => <li key={b}>{b}</li>)}</ul></details>)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
