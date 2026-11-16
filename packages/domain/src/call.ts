/** M3 Radar poziva: status poziva iz rokova i ocjena prikladnosti (domenski model, odj. 2–3). Čiste funkcije. */

export type CallStatus = 'announced' | 'open' | 'closed' | 'cancelled';
export type DeadlineKind = 'submission' | 'stage1' | 'stage2' | 'info_day' | 'other';
export interface CallDeadline { kind: DeadlineKind; at: string; label?: string }

const SUBMISSION: readonly DeadlineKind[] = ['submission', 'stage1', 'stage2'];

/** Status iz datuma otvaranja i rokova predaje: prije otvaranja „najavljen”, nakon zadnjeg roka predaje „zatvoren”. */
export function callStatus(call: { opensAt?: string | null; deadlines: CallDeadline[]; cancelled?: boolean }, now: Date = new Date()): CallStatus {
  if (call.cancelled) return 'cancelled';
  const t = now.getTime();
  const subs = call.deadlines.filter((d) => SUBMISSION.includes(d.kind)).map((d) => Date.parse(d.at)).filter((x) => !Number.isNaN(x));
  if (subs.length && t > Math.max(...subs)) return 'closed';
  if (call.opensAt && t < Date.parse(`${call.opensAt}T00:00:00Z`)) return 'announced';
  return subs.length || call.opensAt ? 'open' : 'announced';
}

/** Prvi budući rok (bilo koje vrste) ili null. */
export function nextDeadline(deadlines: CallDeadline[], now: Date = new Date()): CallDeadline | null {
  return [...deadlines].filter((d) => Date.parse(d.at) > now.getTime()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null;
}

/** Broj kalendarskih dana do roka (od početka današnjeg dana, UTC): rok danas = 0, sutra = 1. */
export const daysUntil = (iso: string, now: Date = new Date()): number => {
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((Date.parse(iso) - startOfDay) / 86_400_000);
};

export const FIT_CRITERIA = [
  { key: 'strategic', label: 'Strateško uklapanje' },
  { key: 'capacity', label: 'Kapacitet tima' },
  { key: 'probability', label: 'Vjerojatnost uspjeha' },
  { key: 'financial', label: 'Financijski učinak' },
] as const;
export type FitKey = (typeof FIT_CRITERIA)[number]['key'];
export type FitScores = Record<FitKey, number>;
export type FitRecommendation = 'go' | 'consider' | 'no_go';

/** Ocjena 1–5 po kriteriju → postotak (zbroj / 20) i preporuka: ≥ 70 % go, ≥ 50 % razmotriti, inače no-go. */
export function fitScore(scores: FitScores): { total: number; recommendation: FitRecommendation } {
  for (const c of FIT_CRITERIA) {
    const v = scores[c.key];
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new Error(`Ocjena „${c.label}” mora biti cijeli broj 1–5`);
  }
  const total = Math.round((FIT_CRITERIA.reduce((a, c) => a + scores[c.key], 0) / (FIT_CRITERIA.length * 5)) * 100);
  return { total, recommendation: total >= 70 ? 'go' : total >= 50 ? 'consider' : 'no_go' };
}
