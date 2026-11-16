import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { go, useLoad } from '../lib/hooks';
import { buildChildPackage, flatten, initialForm, slugify, type PackageForm } from '../lib/package-form';
import type { Category, Me, PackageContent, PackageDetail, PackageSummary } from '../lib/types';
import { ActionButton, Chip, ErrorBox, Field, Loading } from '../ui';

const can = (me: Me, p: string) => me.permissions.includes('*') || me.permissions.includes(p);
const METHODS: Record<string, string> = { hourlyRate: 'satnica (godišnji trošak / sati)', dailyRate: 'dnevnica (godišnji trošak / dani)' };

export function Packages({ me, route }: { me: Me; route: string[] }) {
  const [, view, a, b] = route;
  if (view === 'pregled' && a) return <PackageView me={me} packageId={decodeURIComponent(a)} version={b} />;
  if (view === 'novi') return <PackageEditor parentId={a ? decodeURIComponent(a) : undefined} />;
  if (view === 'verzija' && a) return <PackageEditor existingRowId={a} />;
  return <PackageList me={me} />;
}

function PackageList({ me }: { me: Me }) {
  const list = useLoad(() => api<PackageSummary[]>('GET', '/programme-packages'), []);
  return (
    <>
      <h1>Paketi programa</h1>
      <p className="sub">Pravila programa (kategorije troškova, stope, izvještavanje) kao konfiguracija. Globalne pakete održava ArQus; paket po pozivu nasljeđuje programski paket i navodi pravila iz Uputa za prijavitelje.</p>
      {can(me, 'packages:write') && <div className="actions" style={{ marginBottom: 12 }}><button className="primary" onClick={() => go('paketi/novi')}>Novi paket po pozivu</button></div>}
      <div className="card scroll">
        <ErrorBox error={list.error} />
        {!list.data ? <Loading /> : (
          <table>
            <thead><tr><th>Program / poziv</th><th>Oznaka</th><th>Verzija</th><th>Nasljeđuje</th><th>Vrijedi</th><th>Vrsta</th><th>Status</th></tr></thead>
            <tbody>{list.data.map((p) => (
              <tr key={p.id} className="row" tabIndex={0} onClick={() => go(`paketi/pregled/${encodeURIComponent(p.packageId)}/${p.version}`)} onKeyDown={(e) => e.key === 'Enter' && go(`paketi/pregled/${encodeURIComponent(p.packageId)}/${p.version}`)}>
                <td><b>{p.programme}</b>{p.funder && <><br /><span className="muted">{p.funder}</span></>}</td><td>{p.packageId}</td><td>{p.version}</td><td>{p.extendsId ?? '–'}</td>
                <td>{date(p.validFrom)} – {date(p.validTo)}</td><td>{p.scope === 'global' ? 'globalni' : 'vlastiti'}</td><td><Chip s={p.status} tone={p.status === 'published' ? 'ok' : p.status === 'draft' ? 'warn' : 'bad'} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

function CategoryRows({ cats, depth = 0 }: { cats: Category[]; depth?: number }) {
  return <>{cats.map((c) => (
    <Fragment key={c.code}>
      <tr><td style={{ paddingLeft: 9 + depth * 18 }}>{c.code}</td><td>{c.name}</td><td>{({ direct: 'izravni', indirect: 'neizravni', unit: 'jedinični', lumpSum: 'paušal' } as Record<string, string>)[c.kind] ?? c.kind}</td>
        <td>{c.kind === 'indirect' && c.calculation ? `${c.calculation.ratePercent} % na ${c.calculation.baseCategories?.join(', ')}${c.calculation.excludeCategories?.length ? ` bez ${c.calculation.excludeCategories.join(', ')}` : ''}` : ''}</td></tr>
      {c.children && <CategoryRows cats={c.children} depth={depth + 1} />}
    </Fragment>
  ))}</>;
}

function Rules({ pkg }: { pkg: PackageContent }) {
  return (
    <div className="grid g2">
      <div className="card scroll"><h2>Kategorije troškova</h2>
        <table><thead><tr><th>Šifra</th><th>Naziv</th><th>Vrsta</th><th>Izračun</th></tr></thead><tbody><CategoryRows cats={pkg.costCategories} /></tbody></table>
      </div>
      <div className="card">
        <h2>Vrste akcija i stope financiranja</h2>
        <table><tbody>{pkg.actionTypes.map((a) => <tr key={a.code}><td><b>{a.code}</b> {a.name}</td><td>{a.fundingRates.map((r) => `${r.beneficiaryType === 'default' ? 'zadano' : r.beneficiaryType}: ${r.ratePercent} %`).join(' · ')}</td></tr>)}</tbody></table>
        <h2>Izvještavanje i osoblje</h2>
        <div className="kv">
          <b>Izvještajno razdoblje</b><span>{pkg.reporting.periodMonths} mj., rok {pkg.reporting.submissionDeadlineDays} dana</span>
          <b>Trošak osoblja</b><span>{pkg.personnelRule?.method ? `${METHODS[pkg.personnelRule.method] ?? pkg.personnelRule.method}, djelitelj ${pkg.personnelRule.divisor}${pkg.personnelRule.categoryCode ? `, kategorija ${pkg.personnelRule.categoryCode}` : ''}` : '–'}</span>
        </div>
        {(pkg.validations?.length ?? 0) > 0 && <><h2>Provjere</h2>{pkg.validations!.map((v) => <div className="warnbox" key={v.id}><b>{({ error: 'pravilo', warning: 'upozorenje', info: 'napomena' } as Record<string, string>)[v.severity] ?? v.severity}:</b> {v.message}</div>)}</>}
      </div>
    </div>
  );
}

function PackageView({ me, packageId, version }: { me: Me; packageId: string; version?: string }) {
  const pkg = useLoad(() => api<PackageDetail>('GET', `/programme-packages/${encodeURIComponent(packageId)}${version ? `?version=${version}` : ''}`), [packageId, version]);
  const all = useLoad(() => api<PackageSummary[]>('GET', '/programme-packages'), []);
  if (pkg.error) return <ErrorBox error={pkg.error} />;
  if (!pkg.data) return <Loading what="paket" />;
  const p = pkg.data; const row = p._row;
  const write = can(me, 'packages:write');
  const versions = (all.data ?? []).filter((x) => x.packageId === packageId);
  return (
    <>
      <div className="crumbs"><a href="#/paketi">Paketi programa</a> › {packageId} v{row.version}</div>
      <h1>{p.meta.programme} <Chip s={row.status} tone={row.status === 'published' ? 'ok' : 'warn'} /></h1>
      <p className="sub">{row.scope === 'global' ? 'globalni paket' : 'vlastiti paket'} · {packageId} v{row.version}{p.meta.extends ? ` · nasljeđuje ${p.meta.extends}` : ''} · vrijedi {date(p.meta.validFrom)} – {date(p.meta.validTo)}</p>
      {p.meta.notes && <div className="warnbox">{p.meta.notes}</div>}
      {p.meta.sources?.length ? <p className="muted">Izvori: {p.meta.sources.map((s) => <a key={s} href={s} target="_blank" rel="noreferrer noopener" style={{ marginRight: 8, wordBreak: 'break-all' }}>{s}</a>)}</p> : null}
      <div className="actions" style={{ marginBottom: 12 }}>
        {write && row.status === 'published' && <button onClick={() => go(`paketi/novi/${encodeURIComponent(packageId)}`)}>Novi paket po pozivu na temelju ovog</button>}
        {write && row.scope === 'tenant' && <button onClick={() => go(`paketi/verzija/${row.id}`)}>Nova verzija</button>}
        {write && row.scope === 'tenant' && row.status === 'draft' && <>
          <ActionButton kind="primary" confirm="Objaviti paket? Objavljena verzija se više ne mijenja i može se koristiti na projektima." onClick={async () => { await api('POST', `/programme-packages/${row.id}/publish`); await pkg.reload(); await all.reload(); }}>Objavi</ActionButton>
          <ActionButton kind="danger" confirm="Obrisati nacrt?" onClick={async () => { await api('DELETE', `/programme-packages/rows/${row.id}`); go('paketi'); }}>Obriši nacrt</ActionButton>
        </>}
      </div>
      <Rules pkg={p} />
      {versions.length > 1 && <div className="card"><h2>Verzije</h2><table><tbody>{versions.map((v) => <tr key={v.id} className="row" onClick={() => go(`paketi/pregled/${encodeURIComponent(packageId)}/${v.version}`)}><td>v{v.version}</td><td><Chip s={v.status} /></td><td>{date(v.publishedAt)}</td></tr>)}</tbody></table></div>}
    </>
  );
}

function PackageEditor({ parentId: initialParent, existingRowId }: { parentId?: string; existingRowId?: string }) {
  const packages = useLoad(() => api<PackageSummary[]>('GET', '/programme-packages?status=published'), []);
  const existing = useLoad(() => (existingRowId ? api<{ row: PackageSummary; content: PackageContent }>('GET', `/programme-packages/rows/${existingRowId}`) : Promise.resolve(null)), [existingRowId]);
  const [parentId, setParentId] = useState(initialParent ?? '');
  useEffect(() => { if (existing.data?.content.meta.extends) setParentId(existing.data.content.meta.extends); }, [existing.data]);
  const parent = useLoad(() => (parentId ? api<PackageDetail>('GET', `/programme-packages/${encodeURIComponent(parentId)}`) : Promise.resolve(null)), [parentId]);
  const [f, setF] = useState<PackageForm | null>(null);
  useEffect(() => { if (parent.data && (!existingRowId || existing.data)) setF(initialForm(parent.data, existing.data?.content)); }, [parent.data, existing.data, existingRowId]);
  const [json, setJson] = useState<string | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; issues: { path: string; message: string }[]; resolved?: PackageContent } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const allCats = useMemo(() => (parent.data ? flatten(parent.data.costCategories).filter((c) => c.kind !== 'indirect') : []), [parent.data]);
  const body = (): unknown => (json !== null ? JSON.parse(json) : f && parent.data ? buildChildPackage(parent.data, f) : null);
  const set = (patch: Partial<PackageForm>) => { setF((x) => (x ? { ...x, ...patch } : x)); setCheck(null); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e); } finally { setBusy(false); } };
  const parents = (packages.data ?? []).filter((p, i, arr) => arr.findIndex((x) => x.packageId === p.packageId) === i);
  return (
    <>
      <div className="crumbs"><a href="#/paketi">Paketi programa</a> › {existingRowId ? 'nova verzija' : 'novi paket po pozivu'}</div>
      <h1>{existingRowId ? `Nova verzija: ${existing.data?.row.packageId ?? ''}` : 'Novi paket po pozivu'}</h1>
      <p className="sub">Paket nasljeđuje sva pravila programskog paketa; ovdje upiši ono što propisuju Upute za prijavitelje poziva. Prije spremanja provjeri paket – sustav prikazuje razriješena pravila.</p>
      <div className="card">
        <div className="form">
          <Field label="Programski paket (roditelj)">
            <select value={parentId} disabled={!!existingRowId} onChange={(e) => { setParentId(e.target.value); setF(null); setJson(null); setCheck(null); }}>
              <option value="">– odaberi –</option>
              {parents.map((p) => <option key={p.packageId} value={p.packageId}>{p.programme} ({p.packageId})</option>)}
            </select>
          </Field>
        </div>
        <ErrorBox error={packages.error ?? parent.error ?? existing.error} />
      </div>
      {parentId && !f && <Loading what="pravila programa" />}
      {f && parent.data && (
        <>
          {json === null ? (
            <>
              <div className="card"><h2>Poziv</h2>
                <div className="form">
                  <Field label="Identifikator poziva" hint="npr. NPOO.C3.2.R2-I1.05"><input value={f.callCode} onChange={(e) => set({ callCode: e.target.value, ...(existingRowId ? {} : { id: slugify(e.target.value) }) })} /></Field>
                  <Field label="Oznaka paketa" hint="mala slova, brojke i crtice"><input value={f.id} disabled={!!existingRowId} onChange={(e) => set({ id: slugify(e.target.value) })} required /></Field>
                  <Field label="Naziv"><input value={f.programme} onChange={(e) => set({ programme: e.target.value })} placeholder="NPOO – naziv poziva" required /></Field>
                  <Field label="Verzija"><input value={f.version} onChange={(e) => set({ version: e.target.value })} required /></Field>
                  <Field label="Vrijedi od"><input type="date" value={f.validFrom} onChange={(e) => set({ validFrom: e.target.value })} required /></Field>
                  <Field label="Vrijedi do"><input type="date" value={f.validTo} onChange={(e) => set({ validTo: e.target.value })} /></Field>
                  <Field label="Upute za prijavitelje (poveznica)"><input type="url" value={f.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} /></Field>
                  <Field label="Napomena"><input value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
                </div>
              </div>
              <div className="grid g2">
                <div className="card"><h2>Stope financiranja (%)</h2>
                  {parent.data.actionTypes.map((a) => (
                    <div className="form" key={a.code}>{a.fundingRates.map((r) => (
                      <Field key={r.beneficiaryType} label={`${a.code} – ${r.beneficiaryType === 'default' ? 'zadano' : r.beneficiaryType}`}>
                        <input inputMode="decimal" value={f.rates[a.code]?.[r.beneficiaryType] ?? ''} onChange={(e) => set({ rates: { ...f.rates, [a.code]: { ...f.rates[a.code], [r.beneficiaryType]: e.target.value } } })} />
                      </Field>))}</div>
                  ))}
                  <h2>Izvještavanje i osoblje</h2>
                  <div className="form">
                    <Field label="Izvještajno razdoblje (mj.)"><input type="number" min={1} value={f.periodMonths} onChange={(e) => set({ periodMonths: e.target.value })} /></Field>
                    <Field label="Rok predaje (dana)"><input type="number" min={0} value={f.deadlineDays} onChange={(e) => set({ deadlineDays: e.target.value })} /></Field>
                    <Field label="Izračun troška osoblja"><select value={f.personnelMethod} onChange={(e) => set({ personnelMethod: e.target.value })}><option value="">kao roditelj</option>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                    <Field label="Djelitelj (sati ili dani)"><input type="number" min={1} value={f.personnelDivisor} onChange={(e) => set({ personnelDivisor: e.target.value })} /></Field>
                  </div>
                </div>
                <div className="card"><h2>Neizravni troškovi</h2>
                  {Object.entries(f.indirect).length === 0 && <p className="muted">Programski paket nema neizravnih troškova.</p>}
                  {Object.entries(f.indirect).map(([code, v]) => (
                    <div key={code}>
                      <Field label={`${code} – stopa (%)`}><input inputMode="decimal" value={v.rate} onChange={(e) => set({ indirect: { ...f.indirect, [code]: { ...v, rate: e.target.value } } })} style={{ maxWidth: 120 }} /></Field>
                      <p className="muted" style={{ margin: '8px 0 4px' }}>Osnovica (kategorije na koje se stopa primjenjuje):</p>
                      <div className="actions" style={{ marginTop: 0 }}>{[...allCats, ...f.extraCategories.filter((c) => c.code).map((c) => ({ code: c.code, name: c.name, kind: 'direct' }))].map((c) => (
                        <label key={c.code} className="chip" style={{ cursor: 'pointer' }}><input type="checkbox" checked={v.base.includes(c.code)} onChange={(e) => set({ indirect: { ...f.indirect, [code]: { ...v, base: e.target.checked ? [...v.base, c.code] : v.base.filter((x) => x !== c.code) } } })} /> {c.code}</label>
                      ))}</div>
                    </div>
                  ))}
                  <h2>Dodatne kategorije troškova</h2>
                  {f.extraCategories.map((c, i) => (
                    <div className="form" key={i}>
                      <Field label="Šifra"><input value={c.code} onChange={(e) => set({ extraCategories: f.extraCategories.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)) })} /></Field>
                      <Field label="Naziv"><input value={c.name} onChange={(e) => set({ extraCategories: f.extraCategories.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></Field>
                      <div className="actions"><button className="danger" onClick={() => set({ extraCategories: f.extraCategories.filter((_, j) => j !== i) })}>ukloni</button></div>
                    </div>
                  ))}
                  <div className="actions"><button onClick={() => set({ extraCategories: [...f.extraCategories, { code: '', name: '' }] })}>Dodaj kategoriju</button></div>
                </div>
              </div>
            </>
          ) : (
            <div className="card"><h2>JSON paketa</h2>
              <p className="muted">Napredno uređivanje prema shemi paketa v1. Paket mora imati <code>meta.extends</code> i samo razlike u odnosu na roditelja.</p>
              <textarea aria-label="JSON paketa" value={json} onChange={(e) => { setJson(e.target.value); setCheck(null); }} rows={24} style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 13 }} spellCheck={false} />
            </div>
          )}
          <div className="card">
            <div className="actions" style={{ marginTop: 0 }}>
              <button disabled={busy} onClick={() => setJson(json === null ? JSON.stringify(body(), null, 2) : null)}>{json === null ? 'Uredi kao JSON' : 'Natrag na obrazac'}</button>
              <button disabled={busy} onClick={() => run(async () => setCheck(await api('POST', '/programme-packages/validate', body())))}>Provjeri paket</button>
              <button className="primary" disabled={busy} onClick={() => run(async () => {
                const saved = await api<PackageSummary>('POST', '/programme-packages', body());
                go(`paketi/pregled/${encodeURIComponent(saved.packageId)}/${saved.version}`);
              })}>Spremi nacrt</button>
            </div>
            <ErrorBox error={error} />
            {check && (check.ok ? <div className="warnbox" role="status"><span className="chip ok">paket je valjan</span> Razriješena pravila (s naslijeđenima):</div>
              : <div className="alert" role="alert"><b>Paket nije valjan</b><ul>{check.issues.map((i) => <li key={i.path + i.message}>{i.path}: {i.message}</li>)}</ul></div>)}
          </div>
          {check?.ok && check.resolved && <Rules pkg={check.resolved} />}
        </>
      )}
    </>
  );
}
