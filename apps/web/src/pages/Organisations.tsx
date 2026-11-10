import { useState } from 'react';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import type { Me, Organisation } from '../lib/types';
import { ActionForm, ErrorBox, Field, Loading } from '../ui';

const TYPES: Record<string, string> = { university: 'sveučilište', faculty: 'fakultet', institute: 'institut', sme: 'MSP', large_enterprise: 'veliko poduzeće', public_body: 'javno tijelo', ngo: 'udruga', other: 'ostalo' };

export function Organisations({ me }: { me: Me }) {
  const [q, setQ] = useState('');
  const orgs = useLoad(() => api<Organisation[]>('GET', `/organisations${q ? `?q=${encodeURIComponent(q)}` : ''}`), [q]);
  const canWrite = me.permissions.includes('*') || me.permissions.includes('organisations:write');
  const [f, setF] = useState({ name: '', country: 'HR', type: 'other', pic: '', oib: '', nonProfit: false });
  return (
    <>
      <h1>Organizacije</h1>
      <p className="sub">Registar partnera i ostalih organizacija s kojima institucija radi na projektima.</p>
      {canWrite && (
        <div className="card">
          <h2>Nova organizacija</h2>
          <ActionForm submit="Dodaj" onSubmit={async () => {
            await api('POST', '/organisations', { name: f.name, country: f.country, type: f.type, nonProfit: f.nonProfit, identifiers: { ...(f.pic ? { pic: f.pic } : {}), ...(f.oib ? { oib: f.oib } : {}) } });
            setF({ name: '', country: 'HR', type: 'other', pic: '', oib: '', nonProfit: false }); await orgs.reload();
          }}>
            <Field label="Naziv"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
            <Field label="Država (ISO)"><input value={f.country} maxLength={2} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} required /></Field>
            <Field label="Vrsta"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="PIC" hint="9 znamenki"><input value={f.pic} onChange={(e) => setF({ ...f, pic: e.target.value })} /></Field>
            <Field label="OIB" hint="11 znamenki"><input value={f.oib} onChange={(e) => setF({ ...f, oib: e.target.value })} /></Field>
            <label className="field"><span>Neprofitna</span><input type="checkbox" checked={f.nonProfit} onChange={(e) => setF({ ...f, nonProfit: e.target.checked })} /></label>
          </ActionForm>
        </div>
      )}
      <div className="card scroll">
        <div className="actions" style={{ marginTop: 0, marginBottom: 8 }}><input placeholder="Pretraži po nazivu" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Pretraga" /></div>
        <ErrorBox error={orgs.error} />
        {orgs.loading && !orgs.data ? <Loading /> : (
          <table>
            <thead><tr><th>Naziv</th><th>Država</th><th>Vrsta</th><th>PIC</th><th>OIB</th><th>Neprofitna</th></tr></thead>
            <tbody>{orgs.data?.map((o) => (
              <tr key={o.id}><td>{o.name}{o.isSelf && <> <span className="chip acc">vlastita</span></>}</td><td>{o.country}</td><td>{TYPES[o.type] ?? o.type}</td><td>{o.identifiers.pic ?? '–'}</td><td>{o.identifiers.oib ?? '–'}</td><td>{o.nonProfit ? 'da' : 'ne'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
