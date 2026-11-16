/**
 * Politika lozinki prema OWASP ASVS 4.0.3 V2.1 i NIST SP 800-63B: duljina umjesto pravila sastava,
 * odbijanje čestih lozinki, ponavljanja, nizova i lozinki iz osobnih podataka. Čista funkcija (koristi je API i web).
 */
const COMMON = new Set([
  'password', 'passw0rd', 'lozinka', 'zaporka', 'sifra', 'administrator', 'admin', 'welcome', 'qwerty', 'qwertz', 'iloveyou', 'letmein', 'dragon',
  'monkey', 'sunshine', 'princess', 'football', 'baseball', 'master', 'superman', 'trustno1', 'changeme', 'default', 'secret', 'arqus', 'arqusprojekti',
  'projekt', 'projekti', 'fakultet', 'sveuciliste', 'hrvatska', 'zagreb', 'split', 'rijeka', 'osijek', 'proljece', 'ljeto', 'jesen', 'zima',
]);
const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'qwertzuiop', 'asdfghjkl', 'yxcvbnm', 'zxcvbnm'];

export interface PasswordContext { email?: string; displayName?: string; tenantSlug?: string }

function isSequenceRun(s: string): boolean {
  if (s.length < 6) return false;
  return SEQUENCES.some((seq) => {
    const fwd = seq.repeat(4), rev = [...seq].reverse().join('').repeat(4);
    return fwd.includes(s) || rev.includes(s);
  });
}

export function passwordIssues(password: string, ctx: PasswordContext = {}): string[] {
  const issues: string[] = [];
  if (password.length < 12) issues.push('lozinka mora imati najmanje 12 znakova');
  if (password.length > 128) issues.push('lozinka smije imati najviše 128 znakova');
  const lower = password.toLowerCase();
  const letters = lower.replace(/[^a-zčćđšž]/g, '');
  const core = lower.replace(/[^a-z0-9čćđšž]/g, '');
  // Česta riječ uz dodane brojeve ili znakove (npr. "Lozinka-123456") jednako je slaba kao i sama riječ.
  if (letters.length > 0 && COMMON.has(letters)) issues.push('lozinka je prečesta – odaberi rečenicu ili niz nepovezanih riječi');
  if (/^(.)\1+$/.test(password)) issues.push('lozinka se sastoji od istog znaka');
  else if (isSequenceRun(core) && core.length === password.length) issues.push('lozinka je niz uzastopnih znakova');
  if (new Set(password).size < 5) issues.push('lozinka ima premalo različitih znakova');
  const personal = [ctx.email?.split('@')[0], ctx.tenantSlug, ...(ctx.displayName?.split(/\s+/) ?? [])].filter((x): x is string => !!x && x.length >= 4).map((x) => x.toLowerCase());
  if (personal.some((p) => lower.includes(p))) issues.push('lozinka ne smije sadržavati ime, e-adresu ni oznaku institucije');
  return issues;
}
