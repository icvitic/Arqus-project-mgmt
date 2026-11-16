import { Pool } from 'pg';
import { selectFtCalls, type FtResult } from '@arqus/domain';

/** Javni SEDIA search API portala EU Funding & Tenders (bez ključa; `apiKey=SEDIA` je javni ključ portala). */
const FT_SEARCH = process.env.FT_SEARCH_URL ?? 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';
const PAGE = 100; const MAX_PAGES = 40;
// Teme (grant, poziv za prijedloge, kaskadno financiranje) koje su najavljene ili otvorene, razdoblje 2021–2027.
const QUERY = { bool: { must: [{ terms: { type: ['1', '2', '8'] } }, { terms: { status: ['31094501', '31094502'] } }, { term: { programmePeriod: '2021 - 2027' } }] } };
const SORT = [{ field: 'sortStatus', order: 'ASC' }, { field: 'deadlineDate', order: 'ASC' }];

const json = (v: unknown) => new Blob([JSON.stringify(v)], { type: 'application/json' });

async function page(n: number, fetchImpl: typeof fetch): Promise<{ results: FtResult[]; totalResults: number }> {
  for (let attempt = 1; ; attempt++) {
    const form = new FormData();
    form.append('query', json(QUERY)); form.append('sort', json(SORT)); form.append('languages', json(['en']));
    const res = await fetchImpl(`${FT_SEARCH}?apiKey=SEDIA&text=***&pageSize=${PAGE}&pageNumber=${n}`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
    if (res.ok) return (await res.json()) as { results: FtResult[]; totalResults: number };
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise((r) => setTimeout(r, attempt * 5_000)); continue; }
    throw new Error(`F&T search: HTTP ${res.status} (stranica ${n})`);
  }
}

/** Sve stranice rezultata (najviše MAX_PAGES × PAGE). */
export async function fetchFtResults(fetchImpl: typeof fetch = fetch): Promise<FtResult[]> {
  const all: FtResult[] = [];
  for (let n = 1; n <= MAX_PAGES; n++) {
    const p = await page(n, fetchImpl);
    all.push(...(p.results ?? []));
    if (!p.results?.length || n * PAGE >= p.totalResults) break;
  }
  return all;
}

export interface FtImportReport { fetched: number; inserted: number; updated: number; keptManual: number; skipped: { duplicate: number; invalid: number; expired: number } }

/**
 * Upsert globalnih poziva (tenant_id NULL) vlasničkom ulogom – aplikacijska uloga ne smije pisati globalne retke.
 * Ručno uneseni globalni poziv s istom oznakom se ne prepisuje; praćenje (ocjena, odluka) po stanaru ostaje netaknuto.
 */
export async function importFtCalls(ownerUrl: string, results: FtResult[], now = new Date()): Promise<FtImportReport> {
  const { calls, skipped } = selectFtCalls(results, now);
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  const report: FtImportReport = { fetched: results.length, inserted: 0, updated: 0, keptManual: 0, skipped };
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const c of calls) {
      const r = await client.query<{ inserted: boolean }>(
        `insert into calls (tenant_id, code, title, summary, programme, funder, package_id, action_types, opens_at, deadlines, url, source, synced_at)
         values (null, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ft', now())
         on conflict (code) where tenant_id is null do update set
           title = excluded.title, summary = excluded.summary, programme = excluded.programme, funder = excluded.funder, package_id = excluded.package_id,
           action_types = excluded.action_types, opens_at = excluded.opens_at, deadlines = excluded.deadlines, url = excluded.url, synced_at = now(),
           updated_at = case when (calls.title, calls.deadlines, calls.opens_at) is distinct from (excluded.title, excluded.deadlines, excluded.opens_at) then now() else calls.updated_at end
         where calls.source = 'ft'
         returning (xmax = 0) as inserted`,
        [c.code, c.title, c.summary, c.programme, c.funder, c.packageId, c.actionTypes, c.opensAt, JSON.stringify(c.deadlines), c.url]);
      if (!r.rows.length) report.keptManual++; else if (r.rows[0]!.inserted) report.inserted++; else report.updated++;
    }
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); await pool.end(); }
  return report;
}
