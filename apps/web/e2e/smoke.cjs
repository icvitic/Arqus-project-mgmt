/* E2E provjera web sučelja na pravom API-ju (Playwright). Pokretanje: apps/web/e2e/run-local.sh
 * Tok: prijava → paket → radar (go) → organizacija → prijava na poziv (konzorcij, RP, proračun, predaja, ishod) → ugovaranje u projekt → aktivacija → tim i timesheet (predaja, odobrenje)
 *      → trošak (dokaz) → ZNS → dokumenti (otvaranje, predaja) → ugovoreno/ostvareno. Bilježi greške konzole i neuspjele zahtjeve. */
const { chromium } = require('playwright');
const { createHmac } = require('node:crypto');
// TOTP (RFC 6238) za korak MFA u testu.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(secretB32, offset = 0) {
  let bits = 0, value = 0; const bytes = [];
  for (const ch of secretB32.replace(/=+$/, '')) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest(); const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}
const WEB = process.env.WEB_URL ?? 'http://localhost:4173';
const SLUG = process.env.E2E_TENANT ?? 'e2e'; const EMAIL = process.env.E2E_EMAIL ?? 'admin@e2e.local'; const PW = process.env.E2E_PASSWORD ?? 'E2e-lozinka-123';
const SHOTS = process.env.E2E_SHOTS; // mapa za snimke zaslona (neobavezno)
const tag = Date.now().toString(36);

(async () => {
  const pkgId = `npoo-e2e-${tag}`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // Neočekivani HTTP odgovori; 401 na prijavi s MFA je očekivan (traži se kod).
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !(r.status() === 401 && r.url().endsWith('/api/auth/login'))) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
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
  await step('paket po pozivu (sučelje)', async () => {
    await page.getByRole('link', { name: 'Paketi programa' }).click();
    await page.getByRole('button', { name: 'Novi paket po pozivu' }).click();
    await page.getByLabel('Programski paket (roditelj)').selectOption('npoo-2021-2026');
    await page.getByLabel('Identifikator poziva').fill(`NPOO.E2E.${tag}`);
    await page.getByLabel('Naziv', { exact: true }).fill(`NPOO e2e poziv ${tag}`);
    await page.getByLabel('Vrijedi od').fill('2026-10-01');
    await page.getByLabel('Izvještajno razdoblje (mj.)').fill('6');
    await page.getByRole('button', { name: 'Provjeri paket' }).click();
    await page.getByText('paket je valjan').waitFor();
    await page.getByRole('button', { name: 'Spremi nacrt' }).click();
    await page.getByRole('heading', { name: new RegExp(`NPOO e2e poziv ${tag}`) }).waitFor();
    await page.getByRole('button', { name: 'Objavi' }).click();
    await page.locator('h1 .chip', { hasText: 'objavljen' }).waitFor();
    await shot('paket');
  });
  await step('radar: novi poziv, ocjena, odluka go', async () => {
    const local = new Date(Date.now() + 30 * 86400000); const pad = (n) => String(n).padStart(2, '0');
    const dl = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T17:00`;
    await page.getByRole('link', { name: 'Radar poziva' }).click();
    await page.getByRole('button', { name: 'Novi poziv' }).click();
    await page.getByLabel('Identifikator poziva').fill(`NPOO.E2E.${tag}`);
    await page.getByLabel('Naslov').fill('Zeleni promet – e2e poziv');
    await page.getByLabel('Program', { exact: true }).fill('NPOO');
    await page.getByLabel('Paket programa').selectOption(pkgId);
    await page.getByLabel('Rok predaje').fill(dl);
    await page.getByRole('button', { name: 'Spremi poziv' }).click();
    await page.getByRole('heading', { name: /Zeleni promet – e2e poziv/ }).waitFor();
    for (const [l, v] of [['Strateško uklapanje', '5'], ['Kapacitet tima', '4'], ['Vjerojatnost uspjeha', '3'], ['Financijski učinak', '3']]) await page.getByLabel(l).fill(v);
    await page.getByRole('button', { name: 'Spremi ocjenu' }).click();
    await page.getByRole('cell', { name: /ocjena 75 %/ }).waitFor();
    await page.getByLabel('Go – prijavljujemo se').check();
    await page.getByLabel('Obrazloženje').fill('Uklapa se u strategiju zelenog prometa');
    await page.getByRole('button', { name: 'Spremi odluku' }).click();
    await page.getByRole('cell', { name: /odluka: go/ }).waitFor();
    await page.getByRole('link', { name: 'Radar poziva' }).first().click();
    await page.getByRole('cell', { name: new RegExp(`NPOO.E2E.${tag}`) }).first().waitFor();
    await shot('radar');
  });
  await step('nova organizacija', async () => {
    await page.getByRole('link', { name: 'Organizacije' }).click();
    await page.getByLabel('Naziv').fill(`Politecnico di Milano ${tag}`);
    await page.getByLabel('Država (ISO)').fill('IT');
    await page.getByRole('button', { name: 'Dodaj' }).click();
    await page.getByRole('cell', { name: `Politecnico di Milano ${tag}` }).waitFor();
  });
  await step('prijava iz radara (odluka go)', async () => {
    await page.getByRole('link', { name: 'Radar poziva' }).click();
    await page.getByRole('cell', { name: new RegExp(`NPOO.E2E.${tag}`) }).first().click();
    await page.getByLabel('Akronim prijave').fill(`E2E${tag}`.slice(0, 20));
    await page.getByLabel('Naslov prijave').fill('Projekt iz e2e testa');
    await page.getByLabel('Vrsta akcije').selectOption('BESPOVRATNA');
    await page.getByLabel('Trajanje (mjeseci)').fill('12');
    await page.getByRole('button', { name: 'Otvori prijavu' }).click();
    await page.getByRole('heading', { name: 'Spremnost za predaju' }).waitFor();
  });
  await step('prijava: konzorcij i struktura rada', async () => {
    await page.getByLabel('Organizacija').selectOption({ label: `Politecnico di Milano ${tag} (IT)` });
    await page.getByRole('button', { name: 'Dodaj člana' }).click();
    await page.getByRole('button', { name: 'Potvrdi', exact: true }).click();
    await page.getByText('potvrđeno').nth(1).waitFor();
    await page.getByLabel('Naslov radnog paketa').fill('Istraživanje');
    await page.getByRole('button', { name: 'Dodaj radni paket' }).click();
    await page.getByRole('cell', { name: 'WP1', exact: true }).waitFor();
  });
  await step('prijava: proračun i spremnost', async () => {
    await page.locator('input[aria-label$=" OS"]').first().fill('20.000');
    await page.locator('input[aria-label$=" VU"]').first().fill('10000,00');
    await page.getByRole('button', { name: 'Spremi proračun' }).click();
    await page.locator('tfoot').getByText(/33\.000,00/).first().waitFor();
    await page.getByRole('button', { name: 'Zaključaj proračun' }).click();
    await page.getByText('spremna', { exact: true }).waitFor();
    await shot('prijava');
  });
  await step('prijava: predaja, ishod, ugovaranje u projekt', async () => {
    await page.getByRole('button', { name: 'Započni pripremu' }).click();
    await page.getByRole('button', { name: 'Pošalji na internu provjeru' }).click();
    await page.getByLabel('Referentni broj prijave').fill(`REF-${tag}`);
    await page.getByRole('button', { name: 'Evidentiraj predaju' }).click();
    await page.locator('h1 .chip', { hasText: 'predan' }).waitFor();
    await page.getByRole('button', { name: 'U evaluaciji' }).click();
    await page.getByLabel('Ishod evaluacije').selectOption('funded');
    await page.getByRole('button', { name: 'Upiši ishod' }).click();
    await page.locator('h1 .chip', { hasText: 'financirana' }).waitFor();
    await page.getByLabel('Broj ugovora').fill(`UG-${tag}`);
    await page.getByLabel('Početak projekta').fill('2027-01-01');
    await page.getByRole('button', { name: 'Ugovori u projekt' }).click();
    await page.getByRole('tab', { name: 'Pregled' }).waitFor();
    await page.getByRole('heading', { name: 'Partneri (2)' }).waitFor();
    await page.getByRole('tab', { name: 'Proračun' }).click();
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
  await step('dokaz uz trošak', async () => {
    await page.getByRole('button', { name: 'Dokazi (0)' }).click();
    await page.getByLabel('Datoteka').setInputFiles({ name: 'Račun 17-2027.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF\n') });
    await page.getByRole('button', { name: 'Priloži dokument' }).click();
    await page.getByRole('button', { name: 'Dokazi (1)' }).waitFor();
    await page.getByRole('cell', { name: /Račun 17-2027\.pdf/ }).last().waitFor();
  });
  await step('ZNS RP1', async () => {
    await page.getByRole('tab', { name: 'Zahtjevi za nadoknadu' }).click();
    await page.getByRole('button', { name: 'Otvori zahtjev' }).click();
    await page.getByRole('heading', { name: /ZNS za RP1/ }).waitFor();
    await page.getByText(/2\.856,50/).first().waitFor(); // 310 + 2.500 + 15 % od 310 = 2.856,50
    await page.getByRole('cell', { name: 'dokaz (1)' }).waitFor();
    await page.getByRole('button', { name: 'Predaj zahtjev' }).click();
    await page.locator('h2 .chip', { hasText: 'predan' }).waitFor();
    await shot('zns');
  });
  await step('dokumenti projekta: ugovor, verzije, preuzimanje', async () => {
    await page.getByRole('tab', { name: 'Dokumenti' }).click();
    await page.getByLabel('Datoteka').setInputFiles({ name: 'Ugovor o dodjeli.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nugovor\n%%EOF\n') });
    await page.getByRole('button', { name: 'Priloži dokument' }).click();
    await page.getByRole('cell', { name: /Ugovor o dodjeli\.pdf/ }).waitFor();
    await page.getByRole('cell', { name: 'trošak', exact: true }).waitFor(); // dokaz troška vidljiv i na razini projekta
    const row = page.locator('tr', { hasText: 'Ugovor o dodjeli.pdf' });
    const [dl] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: 'Preuzmi' }).click()]);
    if (dl.suggestedFilename() !== 'Ugovor o dodjeli.pdf') throw new Error(`preuzeto: ${dl.suggestedFilename()}`);
    await row.getByRole('button', { name: 'Verzije' }).click();
    await page.getByLabel('Nova verzija').setInputFiles({ name: 'Ugovor potpisan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\npotpisan\n%%EOF\n') });
    await page.getByRole('button', { name: 'Učitaj novu verziju' }).click();
    await page.getByText(/v2 · /).waitFor();
    await shot('dokumenti');
  });
  await step('ugovoreno / ostvareno', async () => {
    await page.getByRole('tab', { name: 'Ugovoreno / ostvareno' }).click();
    await page.getByText('iskorištenost proračuna').waitFor();
    await shot('financije');
  });
  const newEmail = `ana.${tag}@e2e.local`; const newPw = `plava-staza-${tag}-uz-more`;
  await step('novi korisnik (administrator)', async () => {
    await page.getByRole('link', { name: 'Korisnici' }).click();
    await page.getByLabel('Ime i prezime').fill('Ana Novak');
    await page.getByLabel('E-adresa').fill(newEmail);
    await page.getByLabel('Privremena lozinka').fill(newPw);
    await page.getByRole('button', { name: 'Dodaj korisnika' }).click();
    await page.getByRole('cell', { name: new RegExp(newEmail.replace('.', '\\.')) }).waitFor();
  });
  const relogin = async (email, pw) => {
    await page.getByRole('button', { name: 'Odjava' }).click();
    await page.getByText('Prijava u sustav za upravljanje projektima.').waitFor();
    await page.getByLabel('E-adresa').fill(email);
    await page.getByLabel('Lozinka').fill(pw);
    await page.getByRole('button', { name: 'Prijava' }).click();
  };
  let secret = '';
  await step('prijava novog korisnika i postavljanje MFA', async () => {
    await relogin(newEmail, newPw);
    await page.getByRole('link', { name: /Ana Novak/ }).click();
    await page.getByRole('button', { name: 'Postavi MFA' }).click();
    secret = (await page.locator('code').first().textContent()).trim();
    await page.getByLabel('Kod iz aplikacije').fill(totp(secret));
    await page.getByRole('button', { name: 'Uključi MFA' }).click();
    await page.getByText('MFA je uključen').waitFor();
    await shot('moj-racun');
  });
  await step('prijava s MFA kodom', async () => {
    await relogin(newEmail, newPw);
    await page.getByLabel('Kod iz aplikacije za autentikaciju').fill(totp(secret, 1));
    await page.getByRole('button', { name: 'Potvrdi kod' }).click();
    await page.getByRole('heading', { name: 'Projekti' }).waitFor();
  });
  await browser.close();
  if (problems.length) { console.error('\nProblemi:\n' + problems.join('\n')); process.exit(1); }
  console.log('\nE2E: sve provjere prošle.');
})().catch((e) => { console.error(e); process.exit(1); });
