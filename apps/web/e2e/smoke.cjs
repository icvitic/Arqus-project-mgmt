/* E2E provjera web sučelja na pravom API-ju (Playwright). Pokretanje: apps/web/e2e/run-local.sh
 * Tok: prijava → organizacija → projekt → partner → radni paket → proračun → aktivacija → tim i timesheet (predaja, odobrenje)
 *      → trošak → ZNS (otvaranje, predaja) → ugovoreno/ostvareno. Bilježi greške konzole i neuspjele zahtjeve. */
const { chromium } = require('playwright');
const WEB = process.env.WEB_URL ?? 'http://localhost:4173';
const API = process.env.ARQUS_API_URL ?? 'http://localhost:3100';
const SLUG = process.env.E2E_TENANT ?? 'e2e'; const EMAIL = process.env.E2E_EMAIL ?? 'admin@e2e.local'; const PW = process.env.E2E_PASSWORD ?? 'E2e-lozinka-123';
const SHOTS = process.env.E2E_SHOTS; // mapa za snimke zaslona (neobavezno)
const tag = Date.now().toString(36);

async function apiCall(method, path, body, tok) {
  const r = await fetch(`${API}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

(async () => {
  // Priprema preko API-ja: objavljen paket po pozivu (upravljanje paketima nije dio sučelja WP1.10).
  const { accessToken } = await apiCall('POST', '/auth/login', { tenantSlug: SLUG, email: EMAIL, password: PW });
  const pkgId = `npoo-e2e-${tag}`;
  const pkg = await apiCall('POST', '/programme-packages', { meta: { id: pkgId, extends: 'npoo-2021-2026', programme: `NPOO e2e poziv ${tag}`, version: '1.0.0', validFrom: '2026-10-01', language: 'hr' }, actionTypes: [], costCategories: [], reporting: { periodMonths: 6, submissionDeadlineDays: 30 } }, accessToken);
  await apiCall('POST', `/programme-packages/${pkg.id}/publish`, undefined, accessToken);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('dialog', (d) => d.accept());
  const step = async (name, fn) => {
    process.stdout.write(`• ${name} … `);
    try { await fn(); } catch (e) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/greska.png`, fullPage: true }); console.error(problems.join('\n')); throw e; }
    console.log('ok');
  };
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

  await step('prijava', async () => {
    await page.goto(WEB);
    await page.getByLabel('Institucija (oznaka)').fill(SLUG);
    await page.getByLabel('E-adresa').fill(EMAIL);
    await page.getByLabel('Lozinka').fill(PW);
    await page.getByRole('button', { name: 'Prijava' }).click();
    await page.getByRole('heading', { name: 'Projekti' }).waitFor();
  });
  await step('nova organizacija', async () => {
    await page.getByRole('link', { name: 'Organizacije' }).click();
    await page.getByLabel('Naziv').fill(`Politecnico di Milano ${tag}`);
    await page.getByLabel('Država (ISO)').fill('IT');
    await page.getByRole('button', { name: 'Dodaj' }).click();
    await page.getByRole('cell', { name: `Politecnico di Milano ${tag}` }).waitFor();
  });
  await step('novi projekt', async () => {
    await page.getByRole('link', { name: 'Projekti' }).click();
    await page.getByRole('button', { name: 'Novi projekt' }).click();
    await page.getByLabel('Akronim').fill(`E2E${tag}`.slice(0, 20));
    await page.getByLabel('Naslov').fill('Projekt iz e2e testa');
    await page.getByLabel('Paket programa').selectOption(pkgId);
    await page.getByLabel('Vrsta akcije').selectOption('BESPOVRATNA');
    await page.getByLabel('Broj ugovora').fill(`UG-${tag}`);
    await page.getByLabel('Početak').fill('2027-01-01');
    await page.getByLabel('Trajanje (mjeseci)').fill('12');
    await page.getByRole('button', { name: 'Stvori projekt' }).click();
    await page.getByRole('tab', { name: 'Pregled' }).waitFor();
  });
  await step('partner', async () => {
    await page.getByLabel('Organizacija').selectOption({ label: `Politecnico di Milano ${tag} (IT)` });
    await page.getByRole('button', { name: 'Dodaj partnera' }).click();
    await page.getByRole('heading', { name: 'Partneri (2)' }).waitFor();
  });
  await step('radni paket', async () => {
    await page.getByRole('tab', { name: 'Struktura rada' }).click();
    await page.getByLabel('Naziv').first().fill('Istraživanje');
    await page.getByRole('button', { name: 'Dodaj radni paket' }).click();
    await page.getByRole('heading', { name: /WP1 Istraživanje/ }).waitFor();
  });
  await step('proračun (neizravni iz paketa)', async () => {
    await page.getByRole('tab', { name: 'Proračun' }).click();
    const row = page.locator('tbody tr').first();
    await row.locator('input[aria-label$=" OS"]').fill('20.000');
    await row.locator('input[aria-label$=" VU"]').fill('10000,00');
    await page.getByRole('button', { name: 'Spremi proračun' }).click();
    await page.locator('tfoot').getByText(/33\.000,00/).first().waitFor();
    await shot('proracun');
  });
  await step('aktivacija', async () => {
    await page.getByRole('tab', { name: 'Pregled' }).click();
    await page.getByRole('button', { name: '→ aktivan' }).click();
    await page.getByRole('cell', { name: 'RP2' }).waitFor();
  });
  await step('tim i timesheet', async () => {
    await page.getByRole('tab', { name: 'Tim i timesheetovi' }).click();
    await page.getByLabel('Ime i prezime').fill('Ivana Horvat');
    await page.getByLabel('Godišnji trošak (€)').fill('34.400');
    await page.getByRole('button', { name: 'Dodaj člana tima' }).click();
    await page.getByRole('cell', { name: 'Ivana Horvat' }).waitFor();
    await page.getByLabel('Mjesec').fill('2027-02');
    await page.getByLabel('WP1 Istraživanje dan 1', { exact: true }).fill('8');
    await page.getByLabel('WP1 Istraživanje dan 2', { exact: true }).fill('7,5');
    await page.getByRole('button', { name: 'Spremi', exact: true }).click();
    await page.getByText('ukupno 15,5 h').waitFor();
    await page.getByRole('button', { name: 'Predaj na odobrenje' }).click();
    await page.getByRole('button', { name: /Odobri/ }).click();
    await page.locator('h3 .chip', { hasText: 'odobren' }).waitFor();
  });
  await step('trošak', async () => {
    await page.getByRole('tab', { name: 'Troškovi' }).click();
    await page.getByLabel('Kategorija').selectOption('VU');
    await page.getByLabel('Datum').fill('2027-03-10');
    await page.getByLabel('Opis').fill('Anketno istraživanje');
    await page.getByLabel('Iznos (€)').fill('2.500,00');
    await page.getByRole('button', { name: 'Evidentiraj trošak' }).click();
    await page.getByRole('cell', { name: 'Anketno istraživanje' }).waitFor();
    await page.getByRole('cell', { name: /310,00/ }).waitFor(); // 15,5 h × 20 €/h
  });
  await step('ZNS RP1', async () => {
    await page.getByRole('tab', { name: 'Zahtjevi za nadoknadu' }).click();
    await page.getByRole('button', { name: 'Otvori zahtjev' }).click();
    await page.getByRole('heading', { name: /ZNS za RP1/ }).waitFor();
    await page.getByText(/2\.856,50/).first().waitFor(); // 310 + 2.500 + 15 % od 310 = 2.856,50
    await page.getByRole('button', { name: 'Predaj zahtjev' }).click();
    await page.locator('h2 .chip', { hasText: 'predan' }).waitFor();
    await shot('zns');
  });
  await step('ugovoreno / ostvareno', async () => {
    await page.getByRole('tab', { name: 'Ugovoreno / ostvareno' }).click();
    await page.getByText('iskorištenost proračuna').waitFor();
    await shot('financije');
  });
  await browser.close();
  if (problems.length) { console.error('\nProblemi:\n' + problems.join('\n')); process.exit(1); }
  console.log('\nE2E: sve provjere prošle.');
})().catch((e) => { console.error(e); process.exit(1); });
