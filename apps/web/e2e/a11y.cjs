/* WP1.22 – automatska provjera pristupačnosti u e2e (axe-core, WCAG 2.0/2.1 razine A i AA).
 *
 * `scan(page, naziv)` pokreće axe na trenutnom stanju stranice u svjetloj i tamnoj temi (prefers-color-scheme) te na
 * širini radne površine i 390 px. Nalazi utjecaja „serious” i „critical” ruše e2e (popis na kraju), manji se ispisuju.
 * Uz to `report()` daje zbroj po pravilu – polazište i stanje nakon ispravaka (docs/PRISTUPACNOST.md).
 *
 * Varijable: A11Y_REPORT=<datoteka.json> zapisuje sve nalaze; A11Y_ONLY_LIGHT=1 samo svjetla tema (brže lokalno).
 */
const axeSource = require('axe-core').source;

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['serious', 'critical']);
const DESKTOP = 1400; const PHONE = 390;

const findings = []; // { screen, variant, id, impact, help, nodes: [...] }
const screens = new Set();
const structural = []; // nalazi skriptiranih provjera (struktura, preljev, fokus, tipkovnica)
const titles = new Map(); // naslov dokumenta → skup ruta (bez id-jeva)
let runs = 0;
const problem = (msg) => { if (!structural.includes(msg)) structural.push(msg); };

async function runAxe(page) {
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(0, 3).join(' ') })) }));
  }, TAGS);
}

/**
 * Provjera jednog stanja zaslona. `opts.widths` – širine (zadano radna površina i 390 px); `opts.schemes` – teme.
 * Nakon provjere vraća polaznu širinu i temu, tako da ostatak e2e toka radi kao prije.
 */
async function scan(page, screen, opts = {}) {
  await structure(page, screen, opts);
  if (opts.reflow !== false) await reflow(page, screen);
  const widths = opts.widths ?? [DESKTOP, PHONE];
  const schemes = opts.schemes ?? (process.env.A11Y_ONLY_LIGHT ? ['light'] : ['light', 'dark']);
  const vp = page.viewportSize() ?? { width: DESKTOP, height: 900 };
  screens.add(screen);
  try {
    for (const width of widths) {
      if (width !== (page.viewportSize() ?? vp).width) { await page.setViewportSize({ width, height: vp.height }); await page.waitForTimeout(80); }
      for (const scheme of schemes) {
        await page.emulateMedia({ colorScheme: scheme });
        const violations = await runAxe(page);
        runs++;
        for (const v of violations) findings.push({ screen, variant: `${scheme} ${width}px`, ...v });
      }
    }
  } finally {
    await page.emulateMedia({ colorScheme: 'light' });
    if ((page.viewportSize() ?? vp).width !== vp.width) await page.setViewportSize(vp);
  }
}

const blocking = () => findings.filter((f) => BLOCKING.has(f.impact));

/**
 * Struktura stanja zaslona (WCAG 1.3.1, 2.4.1, 2.4.2, 2.4.6, 3.1.1, 4.1.3): točno jedan h1, razine naslova bez preskoka,
 * lang="hr", naslov dokumenta po ruti; u prijavljenom dijelu orijentiri (zaglavlje, izbornik s nazivom, jedan main),
 * poveznica „Preskoči na sadržaj” prva u redoslijedu tipke Tab i područje za statusne poruke (aria-live).
 */
async function structure(page, screen, opts = {}) {
  const r = await page.evaluate(() => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => vis(h) && !h.closest('[aria-hidden="true"]') && !h.closest('iframe'));
    const levels = hs.map((h) => Number(h.tagName[1]));
    const jumps = [];
    for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) jumps.push(`${hs[i - 1].tagName}→${hs[i].tagName} („${hs[i].textContent.trim().slice(0, 40)}”)`);
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    const focusables = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter((e) => vis(e) && e.tabIndex >= 0 && !e.disabled);
    return {
      h1: hs.filter((h) => h.tagName === 'H1').length, jumps, lang: document.documentElement.lang, title: document.title,
      hash: location.hash.replace(/\/[0-9a-f-]{36}/g, '/:id').replace(/\/(pozivnica|lozinka)\/[^/]+/, '/$1/:token'),
      app: !!document.querySelector('header.top'),
      mains: document.querySelectorAll('main').length,
      banner: !!document.querySelector('header.top') && !document.querySelector('header.top').closest('main'),
      nav: [...document.querySelectorAll('nav')].every((n) => n.getAttribute('aria-label')),
      firstFocusable: focusables[0] ? (focusables[0].className || focusables[0].tagName) : null,
      live: !!document.querySelector('#announcer[aria-live]'),
      dialog: !!dialog,
    };
  });
  const where = `[${screen}]`;
  if (r.h1 !== 1) problem(`struktura ${where}: ${r.h1} naslova h1 (očekivan točno jedan)`);
  for (const j of r.jumps) problem(`struktura ${where}: preskok razine naslova ${j}`);
  if (r.lang !== 'hr') problem(`struktura ${where}: lang="${r.lang}"`);
  if (!r.title || r.title === 'ArQus Projekti') problem(`struktura ${where}: naslov dokumenta ne opisuje stranicu („${r.title}”)`);
  if (!r.live) problem(`struktura ${where}: nema područja za statusne poruke (#announcer, aria-live)`);
  if (r.app) {
    if (r.mains !== 1) problem(`struktura ${where}: ${r.mains} elemenata main`);
    if (!r.banner) problem(`struktura ${where}: zaglavlje nije orijentir banner`);
    if (!r.nav) problem(`struktura ${where}: izbornik (nav) bez naziva`);
    if (!r.dialog && !String(r.firstFocusable).includes('skip-link')) problem(`struktura ${where}: prvi element u redoslijedu tipke Tab nije „Preskoči na sadržaj” (${r.firstFocusable})`);
  }
  if (!opts.sameTitle) {
    // Ruta za usporedbu: prvi dio adrese (za projekt i kartica) – dva različita zaslona ne smiju dijeliti naslov kartice preglednika.
    const seg = r.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const key = seg[0] === 'projekti' && seg[1] ? `projekti/:id/${seg[2] ?? 'pregled'}` : seg[0];
    if (seg[0]) { const set = titles.get(r.title) ?? new Set(); set.add(key); titles.set(r.title, set); }
  }
}

/**
 * Preljev na 320 CSS px (WCAG 1.4.10; ujedno 400 % uvećanja širine 1280 px): stranica se ne smije pomicati vodoravno.
 * Iznimka su tablice i druga područja koja se pomiču unutar sebe (`.scroll`) – ona moraju biti označena i dostupna
 * tipkovnicom (provjerava axe: scrollable-region-focusable).
 */
async function reflow(page, screen) {
  const vp = page.viewportSize() ?? { width: DESKTOP, height: 900 };
  await page.setViewportSize({ width: 320, height: vp.height });
  await page.waitForTimeout(80);
  try {
    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      if (doc.scrollWidth <= window.innerWidth + 1) return null;
      const clipped = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
      const wide = [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.right > window.innerWidth + 1 && !clipped(e) && getComputedStyle(e).position !== 'fixed'; })
        .slice(0, 3).map((e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').join('.') : ''}`);
      return { width: doc.scrollWidth, wide };
    });
    if (r) problem(`preljev [${screen}]: na 320 px stranica je široka ${r.width} px (${r.wide.join(', ')})`);
  } finally { await page.setViewportSize(vp); }
}

/** Opis elementa u fokusu: oznaka, uloga, naziv (približno kao čitač zaslona) i je li fokus vidljiv. */
const describeFocus = (page) => page.evaluate(() => {
  const e = document.activeElement;
  if (!e || e === document.body) return null;
  const label = e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].textContent) || (e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.textContent) || e.textContent || e.value || '';
  const st = getComputedStyle(e);
  const visible = (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) >= 2) || (st.boxShadow && st.boxShadow !== 'none');
  return { tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || '', name: label.replace(/\s+/g, ' ').trim().slice(0, 80), cls: typeof e.className === 'string' ? e.className : '', visible, inDialog: !!e.closest('[role="dialog"]') };
});

/**
 * Samo tipkovnicom: Tab (ili Shift+Tab) dok fokus ne stigne na element koji odgovara `match` (tekst ili RegExp naziva,
 * ili funkcija nad opisom). Usput provjerava da je fokus na svakom zaustavljanju vidljiv (WCAG 2.4.7).
 */
async function tabTo(page, match, { max = 120, back = false, label } = {}) {
  const ok = typeof match === 'function' ? match : (d) => (match instanceof RegExp ? match.test(d.name) : d.name === match);
  const seen = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    const d = await describeFocus(page);
    if (!d) continue;
    seen.push(d.name);
    if (!d.visible) problem(`fokus [${label ?? 'tipkovnica'}]: fokus nije vidljiv na ${d.tag}${d.role ? `[role=${d.role}]` : ''} „${d.name}”`);
    if (ok(d)) return d;
  }
  throw new Error(`tipkovnica: „${match}” nije dostupan tipkom Tab u ${max} koraka (zadnji: ${seen.slice(-6).join(' | ')})`);
}

/** Fokus ostaje u otvorenom dijalogu (WCAG 2.1.2 bez zamke izvan njega, 2.4.3): N pritisaka Tab i Shift+Tab. */
async function assertFocusInDialog(page, presses = 12) {
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press(key);
      const d = await describeFocus(page);
      if (!d || !d.inDialog) throw new Error(`dijalog: fokus je izašao iz otvorenog dijaloga (${key}, korak ${i + 1}: ${d ? d.name : 'body'})`);
      if (!d.visible) problem(`fokus [dijalog]: fokus nije vidljiv na ${d.tag} „${d.name}”`);
    }
  }
}

/** Sažetak po pravilu; vraća popis blokirajućih nalaza kao tekst (prazno = prolaz). */
function report() {
  const byRule = new Map();
  for (const f of findings) {
    const r = byRule.get(f.id) ?? { impact: f.impact, help: f.help, screens: new Set(), occurrences: 0, nodes: 0 };
    r.screens.add(f.screen); r.occurrences++; r.nodes += f.nodes.length; byRule.set(f.id, r);
  }
  console.log(`\nPristupačnost (axe-core ${require('axe-core/package.json').version}, ${TAGS.join(', ')}): ${screens.size} stanja zaslona, ${runs} provjera.`);
  if (!byRule.size) console.log('  bez nalaza');
  for (const [id, r] of [...byRule].sort((a, b) => b[1].nodes - a[1].nodes)) {
    console.log(`  ${BLOCKING.has(r.impact) ? '✗' : '·'} ${id} (${r.impact}) – ${r.nodes} elemenata u ${r.occurrences} provjera, zasloni: ${[...r.screens].slice(0, 6).join(', ')}${r.screens.size > 6 ? ` … (+${r.screens.size - 6})` : ''}`);
  }
  if (process.env.A11Y_REPORT) require('node:fs').writeFileSync(process.env.A11Y_REPORT, JSON.stringify(findings, null, 1));
  const lines = [];
  // Po pravilu i zaslonu najviše tri primjera (inače bi jedna boja na tablici od 80 redaka zatrpala ispis).
  const groups = new Map();
  for (const f of blocking()) {
    const k = `${f.id}|${f.screen}`;
    const g = groups.get(k) ?? { f, variants: new Set(), nodes: new Map() };
    g.variants.add(f.variant);
    for (const n of f.nodes) if (!g.nodes.has(n.target)) g.nodes.set(n.target, n.summary);
    groups.set(k, g);
  }
  for (const { f, variants, nodes } of groups.values()) {
    const ex = [...nodes].slice(0, 3).map(([t, s]) => `${t} – ${s}`).join(' || ');
    lines.push(`a11y ${f.impact} ${f.id} [${f.screen}; ${[...variants].join(', ')}] ${nodes.size} elemenata: ${ex}`);
  }
  for (const [title, routes] of titles) if (routes.size > 1) problem(`naslov dokumenta „${title}” dijele različite rute: ${[...routes].join(', ')}`);
  console.log(`Skriptirane provjere (struktura, preljev 320 px, fokus, tipkovnica): ${structural.length ? `${structural.length} nalaza` : 'bez nalaza'}.`);
  return [...lines, ...structural];
}

module.exports = { scan, report, blocking, tabTo, assertFocusInDialog, describeFocus, problem };
