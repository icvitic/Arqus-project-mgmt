import { useEffect, useState } from 'react';

interface Health { status: string; version: string; uptimeSeconds: number }
interface PackageSummary { id: string; programme: string; version: string; status?: string }

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch((e: Error) => setError(e.message));
    fetch('/api/programme-packages').then((r) => r.json()).then(setPackages).catch(() => undefined);
  }, []);
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '40px auto', padding: 16 }}>
      <h1>ArQus Projekti</h1>
      <p>Temelji platforme (WP1.1). Sučelje za korisnike dolazi od WP1.2.</p>
      <h2>API</h2>
      {error && <p style={{ color: 'crimson' }}>API nije dostupan: {error}</p>}
      {health && <p>Status: <b>{health.status}</b> · verzija {health.version} · radi {health.uptimeSeconds} s</p>}
      <h2>Paketi programa</h2>
      <ul>{packages.map((p) => <li key={p.id}><b>{p.programme}</b> · {p.id} v{p.version} {p.status ? `(${p.status})` : ''}</li>)}</ul>
    </main>
  );
}
