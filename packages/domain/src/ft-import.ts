/** Uvoz poziva s portala EU Funding & Tenders (javni SEDIA search API): mapiranje teme u poziv radara (bez I/O). */
export interface FtResult { metadata: Record<string, string[] | null | undefined> }
export interface FtCall {
  code: string; callCode: string | null; title: string; programme: string; funder: string; packageId: string | null; actionTypes: string[];
  opensAt: string | null; deadlines: { kind: 'submission' | 'stage1' | 'stage2'; at: string; label?: string }[]; url: string; summary: string; ingestedAt: string | null;
}

/** Okvirni programi (id iz F&T-a) → naziv; paket programa samo gdje postoji u ArQusu. */
export const FT_PROGRAMMES: Record<string, { name: string; code: string; packageId?: string }> = {
  '43108390': { name: 'Horizon Europe', code: 'HORIZON', packageId: 'horizon-europe-2021-2027' },
  '43152860': { name: 'Digital Europe', code: 'DIGITAL' }, '44181033': { name: 'European Defence Fund', code: 'EDF' }, '43252405': { name: 'LIFE', code: 'LIFE' },
  '43251814': { name: 'Creative Europe', code: 'CREA' }, '43251589': { name: 'CERV', code: 'CERV' }, '43298916': { name: 'Euratom', code: 'EURATOM' },
  '43251567': { name: 'Connecting Europe Facility', code: 'CEF' }, '43252476': { name: 'Single Market Programme', code: 'SMP' }, '43353764': { name: 'Erasmus+', code: 'ERASMUS' },
  '44773066': { name: 'Just Transition Mechanism', code: 'JTM' }, '43252368': { name: 'Internal Security Fund', code: 'ISF' }, '44416173': { name: 'Interregional Innovation Investments (I3)', code: 'I3' },
  '43252386': { name: 'Justice', code: 'JUST' }, '43254019': { name: 'European Social Fund+', code: 'ESF' }, '43392145': { name: 'EMFAF', code: 'EMFAF' },
  '43089234': { name: 'Innovation Fund', code: 'INNOVFUND' }, '43332642': { name: 'EU4Health', code: 'EU4H' }, '43254037': { name: 'European Solidarity Corps', code: 'ESC' },
  '43637601': { name: 'Pilot Projects & Preparatory Actions', code: 'PPPA' }, '45876777': { name: 'NDICI – Global Europe', code: 'NDICI' },
};

export const FT_TOPIC_URL = (id: string) => `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${encodeURIComponent(id)}`;

/** Vrste akcije Horizon Europe koje postoje u paketu (RIA/IA/CSA, i u zajedničkim pothvatima – JU). */
export function heActionTypes(types: string[]): string[] {
  const out = new Set<string>();
  for (const t of types.map((x) => x.replace(/\s+/g, ' '))) {
    if (/Research and Innovation Actions?/i.test(t)) out.add('RIA');
    else if (/Innovation Actions?/i.test(t)) out.add('IA');
    if (/Coordination and Support Actions?/i.test(t)) out.add('CSA');
  }
  return [...out];
}

/** Offset zone Europe/Brussels u minutama za dani UTC trenutak. */
function brusselsOffset(utcMs: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - utcMs) / 60000;
}

/** F&T vraća briselsko lokalno vrijeme označeno kao „+0000” (npr. 17:00 = 17:00 Brussels time) → ispravan UTC ISO. */
export function brusselsWallToUtc(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  let utc = wall - brusselsOffset(wall) * 60000;
  utc = wall - brusselsOffset(utc) * 60000; // druga iteracija za dane promjene vremena
  return new Date(utc).toISOString();
}

const one = (m: FtResult['metadata'], k: string): string | null => { const v = m[k]; return Array.isArray(v) && v.length && v[0] ? String(v[0]) : null; };

export function mapFtResult(r: FtResult): FtCall | null {
  const m = r.metadata ?? {};
  const code = one(m, 'identifier'); const title = one(m, 'title');
  if (!code || !title) return null;
  const prog = FT_PROGRAMMES[one(m, 'frameworkProgramme') ?? ''];
  const types = (m.typesOfAction ?? []).filter(Boolean) as string[];
  const model = one(m, 'deadlineModel');
  const dates = ((m.deadlineDate ?? []) as string[]).map(brusselsWallToUtc).filter((x): x is string => !!x).sort();
  const deadlines = model === 'two-stage' && dates.length === 2
    ? [{ kind: 'stage1' as const, at: dates[0]! }, { kind: 'stage2' as const, at: dates[1]! }]
    : dates.map((at, i) => ({ kind: 'submission' as const, at, ...(dates.length > 1 ? { label: `rok ${i + 1}` } : {}) }));
  const callCode = one(m, 'callIdentifier');
  const programme = prog?.name ?? (code.split('-')[0] || 'EU');
  return {
    code, callCode, title, programme, funder: 'Europska komisija', packageId: prog?.packageId ?? null,
    actionTypes: prog?.code === 'HORIZON' ? heActionTypes(types) : [],
    opensAt: one(m, 'startDate')?.slice(0, 10) ?? null, deadlines, url: FT_TOPIC_URL(code),
    summary: [types.length ? `Vrsta akcije: ${types.map((t) => t.replace(/\s+/g, ' ')).join(', ')}` : null, callCode ? `Poziv: ${callCode}` : null, model ? `Model roka: ${model}` : null].filter(Boolean).join(' · '),
    ingestedAt: one(m, 'esDA_IngestDate'),
  };
}

/** Jedinstvene teme (zadnja verzija po identifikatoru), bez onih čiji su svi rokovi prošli (zastarjeli zapisi u indeksu). */
export function selectFtCalls(results: FtResult[], now = new Date()): { calls: FtCall[]; skipped: { duplicate: number; invalid: number; expired: number } } {
  const byCode = new Map<string, FtCall>(); let invalid = 0; let duplicate = 0; let expired = 0;
  for (const r of results) {
    const c = mapFtResult(r);
    if (!c) { invalid++; continue; }
    const prev = byCode.get(c.code);
    if (prev) { duplicate++; if ((c.ingestedAt ?? '') <= (prev.ingestedAt ?? '')) continue; }
    byCode.set(c.code, c);
  }
  const calls: FtCall[] = [];
  for (const c of byCode.values()) {
    if (c.deadlines.length && c.deadlines.every((d) => Date.parse(d.at) < now.getTime())) { expired++; continue; }
    calls.push(c);
  }
  return { calls, skipped: { duplicate, invalid, expired } };
}
