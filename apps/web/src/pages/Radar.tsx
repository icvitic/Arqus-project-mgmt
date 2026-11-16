import { Fragment, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { date, dateTime, eur, label, parseEur } from '../lib/format';
import { go, useLoad } from '../lib/hooks';
import type { CallDetail, CallSummary, Me, PackageDetail, PackageSummary, ProposalSummary, UpcomingDeadline, UserRow } from '../lib/types';
import { ActionForm, Chip, ErrorBox, Field, Loading } from '../ui';

const LIMIT = 100;
const can = (me: Me, p: string) => me.permissions.includes('*') || me.permissions.includes(p);
const KIND: Record<string, string> = { submission: 'rok predaje', stage1: '1. faza', stage2: '2. faza', info_day: 'info-dan', other: 'ostalo', internal: 'interni rok' };
const CRITERIA = [['strategic', 'Strateško uklapanje'], ['capacity', 'Kapacitet tima'], ['probability', 'Vjerojatnost uspjeha'], ['financial', 'Financijski učinak']] as const;
const DECISIONS: [string, string][] = [['go', 'Go – prijavljujemo se'], ['watch', 'Pratimo'], ['no_go', 'No-go – ne prijavljujemo se']];
const daysChip = (d: number | null) => d === null ? null : <span className={`chip ${d <= 7 ? 'bad' : d <= 21 ? 'warn' : ''}`}>{d === 0 ? 'danas' : `za ${d} d`}</span>;
const statusTone: Record<string, string> = { open: 'ok', announced: '', closed: 'warn', cancelled: 'bad' };
const fitPct = (s: Record<string, number>) => Math.round((CRITERIA.reduce((a, [k]) => a + (s[k] ?? 0), 0) / 20) * 100);

export function Radar({ me, route }: { me: Me; route: string[] }) {
  const [, id] = route;
  if (id === 'novi') return <NewCall />;
  if (id) return <CallView me={me} id={id} />;
  return <RadarList me={me} />;
}

function RadarList({ me }: { me: Me }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState(''); // pretraga s odgodom da se ne šalje zahtjev na svaki znak
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const [programme, setProgramme] = useState('');
  const [mine, setMine] = useState(false);
  const [limit, setLimit] = useState(LIMIT);
  const calls = useLoad(() => api<CallSummary[]>('GET', `/calls?${new URLSearchParams({ ...(status ? { status } : {}), ...(query ? { q: query } : {}), ...(programme ? { programme } : {}), ...(mine ? { mine: 'true' } : {}) })}`), [status, query, programme, mine]);
  useEffect(() => setLimit(LIMIT), [status, query, programme, mine]);
  const programmes = useLoad(() => api<{ programme: string; count: number }[]>('GET', '/calls/programmes'), []);
  const sources = useLoad(() => api<{ ft: { count: number; lastSync: string | null; portal: string } }>('GET', '/calls/sources'), []);
  const upcoming = useLoad(() => api<UpcomingDeadline[]>('GET', '/calls/deadlines?days=60'), []);
  return (
    <>
      <h1>Radar poziva</h1>
      <p className="sub">Pozivi koje institucija prati: rokovi, ocjena prikladnosti i odluka go/no-go. Globalne pozive održava ArQus; vlastite unosi ured za projekte.</p>
      <div className="card"><h2>Nadolazeći rokovi (60 dana)</h2>
        <ErrorBox error={upcoming.error} />
        {!upcoming.data ? <Loading /> : upcoming.data.length === 0 ? <p className="muted">Nema rokova za pozive s odlukom go ili „pratimo”.</p> : (
          <table><tbody>{upcoming.data.map((d) => (
            <tr key={`${d.callId}-${d.kind}-${d.at}`} className="row" onClick={() => go(`radar/${d.callId}`)}><td style={{ whiteSpace: 'nowrap' }}>{dateTime(d.at)}</td><td>{daysChip(d.days)}</td><td>{KIND[d.kind] ?? d.label}</td><td><b>{d.code}</b> {d.title}</td><td>{d.decision && <Chip s={d.decision} tone={d.decision === 'go' ? 'acc' : ''} />}</td></tr>
          ))}</tbody></table>
        )}
      </div>
      <div className="actions" style={{ marginBottom: 12 }}>
        {can(me, 'calls:write') && <button className="primary" onClick={() => go('radar/novi')}>Novi poziv</button>}
        <select aria-label="Prikaz poziva" value={mine ? 'mine' : 'all'} onChange={(e) => setMine(e.target.value === 'mine')}><option value="all">svi pozivi</option><option value="mine">vlastiti i praćeni</option></select>
        <select aria-label="Program" value={programme} onChange={(e) => setProgramme(e.target.value)}><option value="">svi programi</option>{programmes.data?.map((p) => <option key={p.programme} value={p.programme}>{p.programme} ({p.count})</option>)}</select>
        <select aria-label="Status poziva" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">svi statusi</option>{['announced', 'open', 'closed', 'cancelled'].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <input aria-label="Pretraga poziva" placeholder="Pretraži (oznaka, naslov, program)" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {sources.data && sources.data.ft.count > 0 && <p className="muted">Globalni pozivi s portala <a href={sources.data.ft.portal} target="_blank" rel="noreferrer noopener">EU Funding &amp; Tenders</a>: {sources.data.ft.count}, zadnje osvježenje {dateTime(sources.data.ft.lastSync)}.</p>}
      <div className="card scroll">
        <ErrorBox error={calls.error} />
        {calls.data && calls.data.length > limit && <p className="muted">Prikazano {limit} od {calls.data.length} poziva (najbliži rokovi prvi). Suzi pretragu ili <button onClick={() => setLimit(limit + LIMIT)}>prikaži još {Math.min(LIMIT, calls.data.length - limit)}</button></p>}
        {!calls.data ? <Loading /> : calls.data.length === 0 ? <p className="muted">Nema poziva.</p> : (
          <table>
            <thead><tr><th>Poziv</th><th>Program</th><th>Sljedeći rok</th><th className="num">Proračun</th><th>Status</th><th className="num">Prikladnost</th><th>Odluka</th></tr></thead>
            <tbody>{calls.data.slice(0, limit).map((c) => (
              <tr key={c.id} className="row" tabIndex={0} onClick={() => go(`radar/${c.id}`)} onKeyDown={(e) => e.key === 'Enter' && go(`radar/${c.id}`)}>
                <td><b>{c.code}</b><br /><span className="muted">{c.title}</span></td>
                <td>{c.programme}{c.scope === 'global' && <> <span className="chip" title={c.source === 'ft' ? 'uvezen s portala EU Funding & Tenders' : 'održava ArQus'}>{c.source === 'ft' ? 'F&T' : 'globalni'}</span></>}</td>
                <td>{c.nextDeadline ? <>{dateTime(c.nextDeadline.at)} {daysChip(c.daysToNextDeadline)}<br /><span className="muted">{KIND[c.nextDeadline.kind]}</span></> : '–'}</td>
                <td className="num">{c.budget !== null ? eur(c.budget) : '–'}{c.expectedGrants ? <><br /><span className="muted">~{c.expectedGrants} projekata</span></> : null}</td>
                <td><Chip s={c.status} tone={statusTone[c.status]} /></td>
                <td className="num">{c.tracking?.fitTotal != null ? <span className={`chip ${c.tracking.fitTotal >= 70 ? 'ok' : c.tracking.fitTotal >= 50 ? 'warn' : 'bad'}`}>{c.tracking.fitTotal} %</span> : <span className="muted">–</span>}</td>
                <td>{c.tracking?.decision ? <Chip s={c.tracking.decision} tone={c.tracking.decision === 'go' ? 'acc' : c.tracking.decision === 'no_go' ? 'bad' : ''} /> : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

function NewCall() {
  const packages = useLoad(() => api<PackageSummary[]>('GET', '/programme-packages?status=published'), []);
  const [f, setF] = useState({ code: '', title: '', programme: '', funder: '', packageId: '', actionTypes: '', budget: '', expectedGrants: '', opensAt: '', submission: '', stage2: '', infoDay: '', url: '', tags: '', summary: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const pkgs = (packages.data ?? []).filter((p, i, a) => a.findIndex((x) => x.packageId === p.packageId) === i);
  return (
    <>
      <div className="crumbs"><a href="#/radar">Radar poziva</a> › novi poziv</div>
      <h1>Novi poziv</h1>
      <p className="sub">Rokovi se unose u lokalnom vremenu preglednika i spremaju s vremenskom zonom.</p>
      <div className="card">
        <ActionForm submit="Spremi poziv" onSubmit={async () => {
          const budget = f.budget ? parseEur(f.budget) : undefined;
          if (budget === null) throw new Error('Neispravan proračun poziva');
          const deadlines = [
            ...(f.infoDay ? [{ kind: 'info_day', at: toIso(f.infoDay) }] : []),
            ...(f.submission ? [{ kind: f.stage2 ? 'stage1' : 'submission', at: toIso(f.submission) }] : []),
            ...(f.stage2 ? [{ kind: 'stage2', at: toIso(f.stage2) }] : []),
          ];
          const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
          const c = await api<CallSummary>('POST', '/calls', {
            code: f.code, title: f.title, programme: f.programme, deadlines, actionTypes: split(f.actionTypes), tags: split(f.tags),
            ...(f.funder ? { funder: f.funder } : {}), ...(f.packageId ? { packageId: f.packageId } : {}), ...(budget !== undefined ? { budget } : {}),
            ...(f.expectedGrants ? { expectedGrants: Number(f.expectedGrants) } : {}), ...(f.opensAt ? { opensAt: f.opensAt } : {}), ...(f.url ? { url: f.url } : {}), ...(f.summary ? { summary: f.summary } : {}),
          });
          go(`radar/${c.id}`);
        }}>
          <Field label="Identifikator poziva"><input value={f.code} onChange={set('code')} required placeholder="npr. NPOO.C3.2.R2-I1.05" /></Field>
          <Field label="Naslov"><input value={f.title} onChange={set('title')} required /></Field>
          <Field label="Program"><input value={f.programme} onChange={set('programme')} required placeholder="NPOO, Horizon Europe, HRZZ…" /></Field>
          <Field label="Financijer / tijelo"><input value={f.funder} onChange={set('funder')} /></Field>
          <Field label="Paket programa" hint="za prijavu na poziv (WP1.5)"><select value={f.packageId} onChange={set('packageId')}><option value="">–</option>{pkgs.map((p) => <option key={p.packageId} value={p.packageId}>{p.programme}</option>)}</select></Field>
          <Field label="Vrste akcija" hint="odvojene zarezom"><input value={f.actionTypes} onChange={set('actionTypes')} /></Field>
          <Field label="Proračun poziva (€)"><input inputMode="decimal" value={f.budget} onChange={set('budget')} /></Field>
          <Field label="Očekivani broj projekata"><input type="number" min={1} value={f.expectedGrants} onChange={set('expectedGrants')} /></Field>
          <Field label="Otvaranje"><input type="date" value={f.opensAt} onChange={set('opensAt')} /></Field>
          <Field label="Rok predaje" hint="kod dvofaznog poziva: 1. faza"><input type="datetime-local" value={f.submission} onChange={set('submission')} /></Field>
          <Field label="Rok 2. faze"><input type="datetime-local" value={f.stage2} onChange={set('stage2')} /></Field>
          <Field label="Info-dan"><input type="datetime-local" value={f.infoDay} onChange={set('infoDay')} /></Field>
          <Field label="Poveznica na poziv"><input type="url" value={f.url} onChange={set('url')} /></Field>
          <Field label="Oznake" hint="odvojene zarezom"><input value={f.tags} onChange={set('tags')} /></Field>
          <Field label="Sažetak"><input value={f.summary} onChange={set('summary')} /></Field>
        </ActionForm>
      </div>
    </>
  );
}

function CallView({ me, id }: { me: Me; id: string }) {
  const call = useLoad(() => api<CallDetail>('GET', `/calls/${id}`), [id]);
  const users = useLoad(() => (can(me, 'users:read') ? api<UserRow[]>('GET', '/users') : Promise.resolve([] as UserRow[])), []);
  const [scores, setScores] = useState<Record<string, number> | null>(null);
  const [comment, setComment] = useState<string | null>(null);
  const [dec, setDec] = useState<{ decision: string; rationale: string; internalDeadline: string; ownerUserId: string } | null>(null);
  if (call.error) return <ErrorBox error={call.error} />;
  if (!call.data) return <Loading what="poziv" />;
  const c = call.data; const t = c.tracking; const write = can(me, 'calls:write');
  const s = scores ?? (t?.fitScores as Record<string, number> | null) ?? { strategic: 3, capacity: 3, probability: 3, financial: 3 };
  const d = dec ?? { decision: t?.decision ?? 'watch', rationale: t?.rationale ?? '', internalDeadline: t?.internalDeadline ?? '', ownerUserId: t?.ownerUserId ?? '' };
  const pct = fitPct(s);
  return (
    <>
      <div className="crumbs"><a href="#/radar">Radar poziva</a> › {c.code}</div>
      <h1>{c.title} <Chip s={c.status} tone={statusTone[c.status]} /></h1>
      <p className="sub">{c.code} · {c.programme}{c.funder ? ` · ${c.funder}` : ''}{c.scope === 'global' ? ' · globalni poziv' : ''}</p>
      <div className="grid g2">
        <div className="card"><h2>Poziv</h2>
          <div className="kv">
            <b>Otvaranje</b><span>{date(c.opensAt)}</span>
            {c.deadlines.map((x) => { const n = new Date(); const days = Math.floor((Date.parse(x.at) - Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())) / 86_400_000); return <Fragment key={`${x.kind}-${x.at}`}><b>{KIND[x.kind] ?? x.kind}</b><span>{dateTime(x.at)} {daysChip(days >= 0 ? days : null)}</span></Fragment>; })}
            <b>Proračun poziva</b><span>{c.budget !== null ? eur(c.budget) : '–'}{c.expectedGrants ? ` (~${c.expectedGrants} projekata, ~${eur(Math.round((c.budget ?? 0) / c.expectedGrants))} po projektu)` : ''}</span>
            <b>Vrste akcija</b><span>{c.actionTypes.join(', ') || '–'}</span>
            <b>Paket programa</b><span>{c.packageId ? <a href={`#/paketi/pregled/${encodeURIComponent(c.packageId)}`}>{c.packageId}</a> : '–'}</span>
            <b>Izvor</b><span>{c.source === 'ft' && <>EU Funding &amp; Tenders, osvježeno {dateTime(c.syncedAt)} · </>}{c.url ? <a href={c.url} target="_blank" rel="noreferrer noopener" style={{ wordBreak: 'break-all' }}>{c.source === 'ft' ? 'otvori na portalu' : c.url}</a> : '–'}</span>
            <b>Oznake</b><span>{c.tags.map((x) => <span key={x} className="chip" style={{ marginRight: 4 }}>{x}</span>)}</span>
          </div>
          {c.summary && <p>{c.summary}</p>}
        </div>
        <div className="card"><h2>Ocjena prikladnosti <span className={`chip ${pct >= 70 ? 'ok' : pct >= 50 ? 'warn' : 'bad'}`}>{pct} %</span></h2>
          <p className="muted">Preporuka: <b>{pct >= 70 ? 'go' : pct >= 50 ? 'razmotriti' : 'no-go'}</b> (≥ 70 % go, ≥ 50 % razmotriti){t?.assessedAt ? ` · zadnja ocjena ${date(t.assessedAt)}` : ''}</p>
          {CRITERIA.map(([k, l]) => (
            <label key={k} className="field" style={{ marginBottom: 6 }}><span>{l}: <b>{s[k]}</b></span>
              <input type="range" min={1} max={5} step={1} value={s[k]} disabled={!write} aria-label={l} onChange={(e) => setScores({ ...s, [k]: Number(e.target.value) })} />
            </label>
          ))}
          {write && <ActionForm submit="Spremi ocjenu" onSubmit={async () => { call.setData(await api<CallDetail>('PUT', `/calls/${id}/assessment`, { scores: s, ...(comment ?? t?.fitComment ? { comment: comment ?? t?.fitComment ?? '' } : {}) })); setScores(null); setComment(null); }}>
            <Field label="Komentar ocjene"><input value={comment ?? t?.fitComment ?? ''} onChange={(e) => setComment(e.target.value)} /></Field>
          </ActionForm>}
        </div>
      </div>
      <div className="grid g2">
        <div className="card"><h2>Odluka {t?.decision && <Chip s={t.decision} tone={t.decision === 'go' ? 'acc' : t.decision === 'no_go' ? 'bad' : ''} />}</h2>
          {t?.decidedAt && <p className="muted">Zadnja odluka {date(t.decidedAt)}{t.rationale ? `: ${t.rationale}` : ''}</p>}
          {write ? (
            <ActionForm submit="Spremi odluku" onSubmit={async () => {
              call.setData(await api<CallDetail>('PUT', `/calls/${id}/decision`, { decision: d.decision, ...(d.rationale ? { rationale: d.rationale } : {}), internalDeadline: d.internalDeadline || null, ownerUserId: d.ownerUserId || null }));
              setDec(null);
            }}>
              <fieldset className="field" style={{ border: 0, padding: 0, gridColumn: '1/-1' }}><legend className="muted" style={{ fontSize: 13 }}>Odluka</legend>
                {DECISIONS.map(([v, l]) => <label key={v} style={{ marginRight: 14 }}><input type="radio" name="decision" value={v} checked={d.decision === v} onChange={() => setDec({ ...d, decision: v })} /> {l}</label>)}
              </fieldset>
              <Field label="Obrazloženje" hint="obvezno za go i no-go"><input value={d.rationale} onChange={(e) => setDec({ ...d, rationale: e.target.value })} /></Field>
              <Field label="Interni rok"><input type="date" value={d.internalDeadline} onChange={(e) => setDec({ ...d, internalDeadline: e.target.value })} /></Field>
              <Field label="Odgovorna osoba"><select value={d.ownerUserId} onChange={(e) => setDec({ ...d, ownerUserId: e.target.value })}><option value="">–</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select></Field>
            </ActionForm>
          ) : <p className="muted">Odluku donosi ured za projekte.</p>}
          {t?.decision === 'go' && <OpenProposal me={me} call={c} />}
        </div>
        <div className="card scroll"><h2>Povijest</h2>
          {c.history.length === 0 ? <p className="muted">Još nema ocjena ni odluka.</p> : (
            <table><tbody>{c.history.map((h, i) => (
              <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{dateTime(h.at)}</td><td>{h.actor ?? '–'}</td>
                <td>{h.action === 'assess' ? `ocjena ${String((h.after as { total?: number } | null)?.total ?? '')} %` : `odluka: ${label(h.action.replace('decision.', ''))}`}{(h.after as { rationale?: string } | null)?.rationale ? ` – ${(h.after as { rationale: string }).rationale}` : ''}</td></tr>
            ))}</tbody></table>
          )}
        </div>
      </div>
    </>
  );
}

function OpenProposal({ me, call }: { me: Me; call: CallDetail }) {
  const list = useLoad(() => (can(me, 'proposals:read') ? api<ProposalSummary[]>('GET', '/proposals') : Promise.resolve([] as ProposalSummary[])), [call.id]);
  const [f, setF] = useState({ acronym: '', title: call.title, durationMonths: '36', actionType: call.actionTypes[0] ?? '' });
  const pkg = useLoad(() => (call.packageId && call.actionTypes.length === 0 ? api<PackageDetail>('GET', `/programme-packages/${encodeURIComponent(call.packageId)}`) : Promise.resolve(null)), [call.packageId]);
  const actions = call.actionTypes.length ? call.actionTypes : pkg.data?.actionTypes.map((a) => a.code) ?? [];
  const existing = list.data?.filter((p) => p.callId === call.id && !['withdrawn', 'rejected'].includes(p.status)) ?? [];
  if (!list.data) return null;
  if (existing[0]) return <p>Prijava: <a href={`#/prijave/${existing[0].id}`}><b>{existing[0].acronym}</b></a> <Chip s={existing[0].status} /></p>;
  if (!can(me, 'proposals:write')) return null;
  if (!call.packageId) return <p className="muted">Za otvaranje prijave iz poziva pozivu dodijeli paket programa.</p>;
  return (
    <ActionForm submit="Otvori prijavu" onSubmit={async () => { const p = await api<{ id: string }>('POST', `/calls/${call.id}/proposal`, { acronym: f.acronym, title: f.title, durationMonths: Number(f.durationMonths), actionType: f.actionType }); go(`prijave/${p.id}`); }}>
      <Field label="Akronim prijave"><input value={f.acronym} onChange={(e) => setF({ ...f, acronym: e.target.value })} required /></Field>
      <Field label="Naslov prijave"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
      <Field label="Vrsta akcije"><select value={f.actionType} onChange={(e) => setF({ ...f, actionType: e.target.value })} required><option value="">– odaberi –</option>{actions.map((a) => <option key={a} value={a}>{a}</option>)}</select></Field>
      <Field label="Trajanje (mjeseci)"><input type="number" min={1} max={120} value={f.durationMonths} onChange={(e) => setF({ ...f, durationMonths: e.target.value })} /></Field>
    </ActionForm>
  );
}
