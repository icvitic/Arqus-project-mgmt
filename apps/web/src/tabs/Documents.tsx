import { useRef, useState } from 'react';
import { api, downloadFile, upload } from '../lib/api';
import { dateTime } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { DocumentDetail, DocumentSummary } from '../lib/types';
import { ActionButton, ActionForm, Chip, ErrorBox, Field, Loading } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';

const KINDS: Record<string, string> = { contract: 'ugovor / sporazum', proposal: 'prijava', deliverable: 'isporuka', evidence: 'dokaz troška', report: 'izvještaj', timesheet: 'evidencija rada', correspondence: 'korespondencija', other: 'ostalo' };
const CONF: Record<string, string> = { public: 'javno', internal: 'interno', confidential: 'povjerljivo' };
const ENTITY: Record<string, string> = { project: 'projekt', expense: 'trošak', deliverable: 'isporuka', claim: 'ZNS', proposal: 'prijava' };
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.docx,.xlsx,.pptx,.odt,.ods,.odp,.zip,.asice,.doc,.xls,.ppt,.msg,.txt,.csv,.xml,.eml,.p7s,.p7m';
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1).replace('.', ',')} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`);

export type DocTarget = { entityType: string; entityId: string };

/** Popis dokumenata (za entitet ili cijeli projekt/prijavu) s učitavanjem, verzijama, preuzimanjem i brisanjem. */
/** `allowConfidential` – korisnik smije označiti dokument povjerljivim (documents:confidential na tom opsegu, WP1.14). */
export function DocumentList({ target, scope, canWrite, allowConfidential = false, defaultKind = 'other', onChange, showEntity }: { target: DocTarget; scope?: string; canWrite: boolean; allowConfidential?: boolean; defaultKind?: string; onChange?: () => void; showEntity?: boolean }) {
  const q = scope ?? `entityType=${target.entityType}&entityId=${target.entityId}`;
  const docs = useLoad(() => api<DocumentSummary[]>('GET', `/documents?${q}`), [q]);
  const [open, setOpen] = useState<string | null>(null);
  const changed = async () => { await docs.reload(); onChange?.(); };
  return (
    <div>
      <ErrorBox error={docs.error} />
      {!docs.data ? <Loading what="dokumente" /> : docs.data.length === 0 ? <p className="muted">Nema priloženih dokumenata.</p> : (
        <table>
          <thead><tr><th>Dokument</th><th>Vrsta</th>{showEntity && <th>Uz</th>}<th>Datoteka</th><th>Ažurirano</th><th /></tr></thead>
          <tbody>{docs.data.map((d) => (
            <DocRow key={d.id} d={d} showEntity={!!showEntity} canWrite={canWrite} open={open === d.id} toggle={() => setOpen(open === d.id ? null : d.id)} changed={changed} />
          ))}</tbody>
        </table>
      )}
      {canWrite && <UploadForm target={target} defaultKind={defaultKind} allowConfidential={allowConfidential} done={changed} />}
    </div>
  );
}

function DocRow({ d, showEntity, canWrite, open, toggle, changed }: { d: DocumentSummary; showEntity: boolean; canWrite: boolean; open: boolean; toggle: () => void; changed: () => Promise<void> }) {
  return (
    <>
      <tr>
        <td><b>{d.title}</b>{d.confidentiality !== 'internal' && <> <Chip s={CONF[d.confidentiality] ?? d.confidentiality} tone={d.confidentiality === 'confidential' ? 'bad' : ''} /></>}{d.aiGenerated && <> <span className="chip warn" title="sadržaj izrađen uz pomoć umjetne inteligencije">AI</span></>}</td>
        <td>{KINDS[d.kind] ?? d.kind}</td>{showEntity && <td>{ENTITY[d.entityType] ?? d.entityType}</td>}
        <td>{d.current.fileName}<br /><span className="muted">v{d.currentVersion} · {size(d.current.size)}</span></td>
        <td>{dateTime(d.updatedAt)}</td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <ActionButton onClick={() => downloadFile(`/documents/${d.id}/download`, d.current.fileName)}>Preuzmi</ActionButton>
          <button onClick={toggle} aria-expanded={open}>{open ? 'Zatvori' : 'Verzije'}</button>
          {canWrite && <ActionButton kind="danger" confirm={`Ukloniti dokument „${d.title}”? Verzije ostaju u revizijskom tragu.`} onClick={async () => { await api('DELETE', `/documents/${d.id}`); await changed(); }}>Ukloni</ActionButton>}
        </td>
      </tr>
      {open && <tr><td colSpan={showEntity ? 6 : 5}><Versions id={d.id} canWrite={canWrite} changed={changed} /></td></tr>}
    </>
  );
}

function Versions({ id, canWrite, changed }: { id: string; canWrite: boolean; changed: () => Promise<void> }) {
  const d = useLoad(() => api<DocumentDetail>('GET', `/documents/${id}`), [id]);
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data) return <Loading />;
  return (
    <div className="sub-panel">
      <table><tbody>{d.data.versions.map((v) => (
        <tr key={v.version}><td>v{v.version}</td><td>{v.fileName}</td><td>{size(v.size)}</td><td>{dateTime(v.createdAt)}</td><td>{v.createdBy ?? '–'}</td><td>{v.note ?? ''}</td>
          <td><code title={v.sha256}>{v.sha256.slice(0, 12)}…</code></td>
          <td><ActionButton onClick={() => downloadFile(`/documents/${id}/versions/${v.version}/download`, v.fileName)}>Preuzmi</ActionButton></td></tr>
      ))}</tbody></table>
      {canWrite && (
        <ActionForm submit="Učitaj novu verziju" onSubmit={async () => {
          const f = file.current?.files?.[0]; if (!f) throw new Error('Odaberi datoteku');
          const form = new FormData(); form.append('file', f); if (note) form.append('note', note);
          await upload(`/documents/${id}/versions`, form); setNote(''); if (file.current) file.current.value = '';
          await d.reload(); await changed();
        }}>
          <Field label="Nova verzija"><input type="file" ref={file} accept={ACCEPT} required /></Field>
          <Field label="Napomena uz verziju"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </ActionForm>
      )}
    </div>
  );
}

function UploadForm({ target, defaultKind, allowConfidential, done }: { target: DocTarget; defaultKind: string; allowConfidential: boolean; done: () => Promise<void> }) {
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ title: '', kind: defaultKind, confidentiality: 'internal', ai: false });
  return (
    <ActionForm submit="Priloži dokument" onSubmit={async () => {
      const x = file.current?.files?.[0]; if (!x) throw new Error('Odaberi datoteku');
      const form = new FormData();
      form.append('entityType', target.entityType); form.append('entityId', target.entityId); form.append('kind', f.kind); form.append('confidentiality', f.confidentiality);
      if (f.title) form.append('title', f.title); if (f.ai) form.append('aiGenerated', 'true');
      form.append('file', x);
      await upload('/documents', form);
      setF({ ...f, title: '', ai: false }); if (file.current) file.current.value = '';
      await done();
    }}>
      <Field label="Datoteka" hint="PDF, slike, Office/ODF, CSV, ZIP, e-potpis; najviše 25 MB"><input type="file" ref={file} accept={ACCEPT} required /></Field>
      <Field label="Naslov dokumenta" hint="zadano: naziv datoteke"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Vrsta dokumenta"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Povjerljivost"><select value={f.confidentiality} onChange={(e) => setF({ ...f, confidentiality: e.target.value })}>{Object.entries(CONF).filter(([k]) => allowConfidential || k !== 'confidential').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <label className="field"><span>Oznaka AI sadržaja</span><span><input type="checkbox" checked={f.ai} onChange={(e) => setF({ ...f, ai: e.target.checked })} /> izrađeno uz pomoć AI-ja</span></label>
    </ActionForm>
  );
}

/** Kartica projekta: svi dokumenti projekta (uz projekt, troškove, isporuke, ZNS); novi se prilažu uz projekt. */
export function DocumentsTab({ project: p, me }: TabProps) {
  const write = can(me, 'documents:write', p.id) && !['closed', 'terminated', 'archived'].includes(p.status);
  return (
    <div className="card scroll">
      <h2>Dokumenti projekta</h2>
      <p className="muted">Ugovor, izvještaji, isporuke i dokazi troškova na jednom mjestu. Svaka izmjena je nova verzija s hashem (SHA-256); dokazi troškova zamrzavaju se predajom zahtjeva za nadoknadu. Povjerljive dokumente vide samo ovlaštene uloge (ured, voditelj, financije).</p>
      <DocumentList target={{ entityType: 'project', entityId: p.id }} scope={`projectId=${p.id}`} showEntity canWrite={write} allowConfidential={can(me, 'documents:confidential', p.id)} defaultKind="contract" />
    </div>
  );
}
