/* E2E provjera web sučelja na pravom API-ju (Playwright). Pokretanje: apps/web/e2e/run-local.sh
 * Tok: prijava → paket → radar (go) → organizacija → prijava na poziv (konzorcij, RP, proračun, predaja, ishod) → ugovaranje u projekt → aktivacija → tim i timesheet (predaja, odobrenje)
 *      → trošak (dokaz) → ZNS (provjera, rana predaja, odluka po trošku, isplata, paket za predaju) → dokumenti (otvaranje, predaja) → ugovoreno/ostvareno → portfelj → korisnik s ulogom samo na projektu (pristup, vidi samo svoj projekt). Bilježi greške konzole i neuspjele zahtjeve.
 * WP1.14b: istovremena izmjena proračuna (drugi korisnik – ured za projekte – sprema prvi; poruka o sukobu, učitavanje, vraćanje vlastitog unosa),
 *      četiri oka na timesheetu (predavatelj ne vidi „Odobri”, odobrava ured), stranica Revizija (filtri, prije/poslije, CSV).
 * WP1.19: obvezni MFA (administrator postroži postavku, ured u otvorenoj sesiji ide na postavljanje MFA), iznosi troškova osoblja
 *      skriveni upravi bez prava na plaće (sati vidljivi).
 * WP1.17: uvoz iz Excela (predložak, greške po retku, pregled s upozorenjem, potvrda, podaci na karticama, povijest).
 * WP1.18: član tima nakon prijave stiže na „Moj rad”, iz stavke otvara timesheet tekućeg mjeseca i predaje ga; voditelj ga vidi
 *      u svojem „Moj rad”, odobrava i stavka nestaje; član tima dobiva obavijest „odobren” u zvoncu.
 * WP1.21: administrator poziva korisnika bez lozinke i kopira poveznicu (instalacija bez e-pošte); pozvani je otvara, sam
 *      bira lozinku i ulazi u aplikaciju (token samo u fragmentu adrese i tijelu zahtjeva, nikad u URL-u zahtjeva);
 *      zaboravljena lozinka daje isti odgovor za postojeći i nepostojeći račun; administrator izdaje poveznicu za novu
 *      lozinku, korisnik je postavlja i prijavljuje se novom lozinkom (MFA se i dalje traži). */
const { chromium } = require('playwright');
const { createHmac } = require('node:crypto');
const a11y = require('./a11y.cjs');
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
let mfaStepUsed = 0; // zadnji TOTP korak koji je test potrošio za novog korisnika
const tag = Date.now().toString(36);

(async () => {
  const pkgId = `npoo-e2e-${tag}`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // Neočekivani HTTP odgovori; 401 na prijavi s MFA je očekivan (traži se kod).
  // WP1.14b: 409 pri spremanju proračuna u koraku istovremene izmjene je očekivan (sukob revizija).
  let expectConflict = false;
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && !(r.status() === 401 && r.url().endsWith('/api/auth/login')) && !(expectConflict && r.status() === 409 && r.url().endsWith('/budget/lines'))) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  page.on('dialog', (d) => d.accept());
  const step = async (name, fn) => {
    process.stdout.write(`• ${name} … `);
    try { await fn(); } catch (e) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/greska.png`, fullPage: true }); console.error([...problems, ...a11y.report()].join('\n')); throw e; }
    console.log('ok');
  };
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
  /** WP1.22: nakon promjene stranice fokus je na naslovu stranice (h1) – hash ruter ne ostavlja fokus na starom mjestu. */
  const expectFocusOnH1 = async (p, text) => {
    for (let i = 0; i < 40; i++) {
      const d = await p.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent ?? '' }));
      if (d.tag === 'H1' && (!text || d.text.includes(text))) return;
      await p.waitForTimeout(50);
    }
    throw new Error(`fokus nakon promjene stranice nije na naslovu h1 („${text}”)`);
  };
  /** WP1.21: korisnik kroz API kao administrator (bez e-pošte API vraća token pozivnice jednom) i prihvaćanje pozivnice. */
  const apiInvite = (email, displayName, roleCodes, pw) => page.evaluate(async ([email, displayName, roleCodes, pw]) => {
    const created = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('arqus.token')}` }, body: JSON.stringify({ email, displayName, roleCodes }) });
    if (created.status !== 201) return created.status;
    const { invitation } = await created.json();
    return (await fetch('/api/auth/invitation/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: invitation.token, password: pw }) })).status;
  }, [email, displayName, roleCodes, pw]);
  /** Nova sesija preglednika (drugi korisnik); bilježi URL-ove svih zahtjeva (provjera da token nije u adresi zahtjeva). */
  const freshContext = async (label) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await ctx.newPage();
    const urls = []; const bodies = [];
    p.on('request', (r) => { urls.push(r.url()); if (r.postData()) bodies.push(r.postData()); });
    p.on('pageerror', (e) => problems.push(`pageerror (${label}): ${e.message}`));
    p.on('dialog', (d) => d.accept());
    return { ctx, p, urls, bodies };
  };
  /** Token iz poveznice nikad u URL-u zahtjeva (samo fragment u adresnoj traci i tijelo POST-a). */
  const assertTokenOnlyInBody = (token, urls, bodies) => {
    const leaked = urls.filter((u) => u.includes(token));
    if (leaked.length) throw new Error(`token u URL-u zahtjeva: ${leaked.join(', ')}`);
    if (!bodies.some((b) => b.includes(token))) throw new Error('token nije poslan u tijelu zahtjeva');
  };
  // Drugi korisnik (ured za projekte) u zasebnoj sesiji preglednika – za istovremenu izmjenu i četiri oka (WP1.14b).
  const officeEmail = `ured.${tag}@e2e.local`; const officePw = `zelena-staza-${tag}-kroz-polje`;
  let office = null;
  const openOffice = async () => {
    if (office) return office;
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    office = await ctx.newPage();
    office.on('pageerror', (e) => problems.push(`pageerror (ured): ${e.message}`));
    office.on('dialog', (d) => d.accept());
    await office.goto(WEB);
    await office.getByLabel('Institucija (oznaka)').fill(SLUG);
    await office.getByLabel('E-adresa').fill(officeEmail);
    await office.getByLabel('Lozinka').fill(officePw);
    await office.getByRole('button', { name: 'Prijava' }).click();
    await office.getByRole('heading', { name: 'Portfelj' }).waitFor();
    return office;
  };

  await step('prijava', async () => {
    await page.goto(WEB);
    await page.getByLabel('Institucija (oznaka)').waitFor();
    await a11y.scan(page, 'prijava');
    // WP1.22 – samo tipkovnicom: Tab do polja, upis, Enter šalje obrazac (bez miša).
    await a11y.tabTo(page, 'Institucija (oznaka)', { label: 'prijava' });
    await page.keyboard.press('Control+A'); await page.keyboard.type(SLUG);
    await a11y.tabTo(page, 'E-adresa', { label: 'prijava' }); await page.keyboard.type(EMAIL);
    await a11y.tabTo(page, 'Lozinka', { label: 'prijava' }); await page.keyboard.type(PW);
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Portfelj', exact: true }).waitFor(); // početna stranica uz portfolio:read (WP1.15)
    await a11y.scan(page, 'portfelj (prazan)');
    // „Preskoči na sadržaj” je prvi u redoslijedu tipke Tab i premješta fokus na glavni sadržaj.
    await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
    const first = await a11y.tabTo(page, () => true, { max: 1, label: 'preskakanje' });
    if (first.name !== 'Preskoči na sadržaj') throw new Error(`prvi element tipke Tab: „${first.name}”`);
    await page.keyboard.press('Enter');
    if ((await page.evaluate(() => document.activeElement?.id)) !== 'sadrzaj') throw new Error('„Preskoči na sadržaj” ne premješta fokus na glavni sadržaj');
    if ((await page.title()) !== 'Portfelj – ArQus Projekti') throw new Error(`naslov dokumenta: ${await page.title()}`);
    // Drugi korisnik: voditeljica ureda za projekte (kroz API, kao administrator).
    const status = await apiInvite(officeEmail, 'Iva Ured', ['project-office'], officePw);
    if (status !== 201) throw new Error(`korisnik ureda nije stvoren (${status})`);
  });
  await step('paket po pozivu (sučelje)', async () => {
    await page.getByRole('link', { name: 'Paketi programa' }).click();
    await page.getByRole('button', { name: 'Novi paket po pozivu' }).waitFor();
    await expectFocusOnH1(page, 'Paketi programa');
    if ((await page.title()) !== 'Paketi programa – ArQus Projekti') throw new Error(`naslov dokumenta: ${await page.title()}`);
    await a11y.scan(page, 'paketi programa');
    await page.getByRole('button', { name: 'Novi paket po pozivu' }).click();
    await page.getByLabel('Programski paket (roditelj)').selectOption('npoo-2021-2026');
    await page.getByLabel('Identifikator poziva').fill(`NPOO.E2E.${tag}`);
    await page.getByLabel('Naziv', { exact: true }).fill(`NPOO e2e poziv ${tag}`);
    await page.getByLabel('Vrijedi od').fill('2026-10-01');
    await page.getByLabel('Izvještajno razdoblje (mj.)').fill('6');
    await page.getByRole('button', { name: 'Provjeri paket' }).click();
    await page.getByText('paket je valjan').waitFor();
    await a11y.scan(page, 'paket: novi (obrazac)');
    await page.getByRole('button', { name: 'Spremi nacrt' }).click();
    await page.getByRole('heading', { name: new RegExp(`NPOO e2e poziv ${tag}`) }).waitFor();
    await page.getByRole('button', { name: 'Objavi' }).click();
    await page.locator('h1 .chip', { hasText: 'objavljen' }).waitFor();
    await a11y.scan(page, 'paket: pojedinosti');
    await shot('paket');
  });
  await step('radar: novi poziv, ocjena, odluka go', async () => {
    const local = new Date(Date.now() + 30 * 86400000); const pad = (n) => String(n).padStart(2, '0');
    const dl = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T17:00`;
    await page.getByRole('link', { name: 'Radar poziva' }).click();
    await page.getByRole('button', { name: 'Novi poziv' }).click();
    await page.getByLabel('Identifikator poziva').waitFor();
    await a11y.scan(page, 'radar: novi poziv (obrazac)');
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
    await a11y.scan(page, 'radar: poziv');
    await page.getByRole('link', { name: 'Radar poziva' }).first().click();
    await page.getByRole('cell', { name: new RegExp(`NPOO.E2E.${tag}`) }).first().waitFor();
    await shot('radar');
    await a11y.scan(page, 'radar');
  });
  await step('radar: globalni poziv s portala F&T', async () => {
    await page.getByLabel('Program').selectOption('Horizon Europe');
    await page.getByLabel('Pretraga poziva').fill('E2E-01');
    await page.getByRole('cell', { name: /HORIZON-CL5-2030-E2E-01/ }).click();
    await page.getByRole('heading', { name: /Zero-emission urban logistics/ }).waitFor();
    await page.getByRole('link', { name: 'otvori na portalu' }).waitFor();
    await page.getByText(/RIA/).first().waitFor();
    await page.getByRole('link', { name: 'Radar poziva' }).first().click();
  });
  await step('nova organizacija', async () => {
    await page.getByRole('link', { name: 'Organizacije' }).click();
    await page.getByLabel('Naziv').fill(`Politecnico di Milano ${tag}`);
    await page.getByLabel('Država (ISO)').fill('IT');
    await page.getByRole('button', { name: 'Dodaj' }).click();
    await page.getByRole('cell', { name: `Politecnico di Milano ${tag}` }).waitFor();
    await a11y.scan(page, 'organizacije');
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
    await a11y.scan(page, 'prijava na poziv');
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
    await a11y.scan(page, 'projekt: pregled');
    await page.getByRole('tab', { name: 'Proračun' }).click();
    await page.locator('tfoot').getByText(/33\.000,00/).first().waitFor();
    await a11y.scan(page, 'projekt: proračun');
    await shot('proracun');
  });
  await step('proračun: istovremena izmjena – poruka o sukobu, najnovije stanje, vlastiti unos sačuvan', async () => {
    const projectUrl = page.url();
    // Oboje imaju otvoren isti proračun; ured sprema prvi.
    const o = await openOffice();
    await o.goto(projectUrl);
    await o.locator('input[aria-label$=" OS"]').first().waitFor();
    await o.locator('input[aria-label$=" OS"]').first().fill('21.000');
    await o.getByRole('button', { name: 'Spremi proračun' }).click();
    await o.locator('tfoot').getByText(/34\.150,00/).first().waitFor(); // OS 21.000 + VU 10.000 + neizravni 15 % OS
    // Administrator (stara revizija) mijenja VU i sprema → 409, ništa nije spremljeno.
    expectConflict = true;
    await page.locator('input[aria-label$=" VU"]').first().fill('11.000');
    await page.getByRole('button', { name: 'Spremi proračun' }).click();
    const notice = page.locator('.alert.conflict');
    await notice.getByText('Tvoje izmjene nisu spremljene.').waitFor();
    await notice.getByText(/promijenio korisnik Iva Ured/).waitFor();
    await a11y.scan(page, 'proračun: obavijest o sukobu');
    await shot('proracun-sukob');
    await notice.getByRole('button', { name: 'Učitaj najnovije stanje' }).click();
    await notice.getByText('Učitano je najnovije stanje').waitFor();
    await page.locator('tfoot').getByText(/34\.150,00/).first().waitFor(); // tablica prikazuje spremljeno stanje (ured)
    await notice.getByRole('cell', { name: /VU/ }).waitFor(); // vlastita nespremljena izmjena ostaje vidljiva
    await notice.getByRole('cell', { name: /11\.000,00/ }).waitFor();
    if (await notice.getByRole('cell', { name: /OS/ }).count()) throw new Error('polje koje korisnik nije mijenjao ne smije se nuditi kao njegova izmjena');
    await shot('proracun-sukob-ucitano');
    await notice.getByRole('button', { name: 'Primijeni moje izmjene na najnovije stanje' }).click();
    expectConflict = false;
    await page.getByRole('button', { name: 'Spremi proračun' }).click();
    await page.locator('tfoot').getByText(/35\.150,00/).first().waitFor(); // obje izmjene: OS 21.000 (ured) + VU 11.000 (moja) + neizravni 3.150
    if (await page.locator('.alert.conflict').count()) throw new Error('obavijest o sukobu nije nestala nakon spremanja');
  });
  await step('kartice projekta tipkovnicom (strelice, Home, End; jedna kartica u redoslijedu tipke Tab)', async () => {
    await page.getByRole('tab', { name: 'Proračun' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('tab', { name: 'Tim i timesheetovi', selected: true }).waitFor();
    if (!/\/tim$/.test(page.url())) throw new Error(`strelica nije otvorila karticu: ${page.url()}`);
    const d = await a11y.describeFocus(page);
    if (d.role !== 'tab' || d.name !== 'Tim i timesheetovi') throw new Error(`fokus nakon strelice: ${d.name}`);
    await page.keyboard.press('Home');
    await page.getByRole('tab', { name: 'Pregled', selected: true }).waitFor();
    if ((await page.locator('[role=tab][tabindex="0"]').count()) !== 1) throw new Error('u traci kartica točno jedna mora biti u redoslijedu tipke Tab');
    if (!/^Pregled – E2E/.test(await page.title())) throw new Error(`naslov dokumenta kartice: ${await page.title()}`);
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
    await page.getByLabel('WP1 Istraživanje dan 1', { exact: true }).waitFor();
    await a11y.scan(page, 'projekt: tim i timesheet');
    await page.getByLabel('WP1 Istraživanje dan 1', { exact: true }).fill('8');
    await page.getByLabel('WP1 Istraživanje dan 2', { exact: true }).fill('7,5');
    await page.getByRole('button', { name: 'Spremi', exact: true }).click();
    await page.getByText('ukupno 15,5 h').waitFor();
    await page.getByRole('button', { name: 'Predaj na odobrenje' }).click();
    // WP1.14b – četiri oka: tko je predao timesheet, ne vidi „Odobri”; odobrava ured za projekte.
    await page.getByText('Timesheet koji si predao odobrava druga osoba s pravom odobravanja (četiri oka).').waitFor();
    if (await page.getByRole('button', { name: /Odobri/ }).count()) throw new Error('predavatelj ne smije vidjeti gumb Odobri');
    const o = await openOffice();
    await o.goto(page.url());
    await o.getByLabel('Mjesec').fill('2027-02');
    await o.getByRole('button', { name: /Odobri/ }).click();
    await o.locator('h3 .chip', { hasText: 'odobren' }).waitFor();
    await page.reload();
    await page.getByLabel('Mjesec').fill('2027-02');
    await page.locator('h3 .chip', { hasText: 'odobren' }).waitFor();
    // WP1.16b: mjesečna evidencija za ispis i potpis (isti dokument kao u paketu ZNS-a).
    await page.getByRole('button', { name: 'Evidencija za ispis i potpis' }).click();
    await page.frameLocator('iframe[title="Evidencija rada za ispis"]').getByText('Ivana Horvat').first().waitFor();
    await a11y.scan(page, 'timesheet: evidencija za ispis (dijalog)');
    await page.getByRole('button', { name: 'Zatvori evidenciju za ispis' }).click();
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
    await a11y.scan(page, 'projekt: troškovi');
  });
  await step('dokaz uz trošak', async () => {
    await page.getByRole('button', { name: 'Dokazi (0)' }).click();
    await page.getByLabel('Datoteka').setInputFiles({ name: 'Račun 17-2027.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF\n') });
    await page.getByRole('button', { name: 'Priloži dokument' }).click();
    await page.getByRole('button', { name: 'Dokazi (1)' }).waitFor();
    await page.getByRole('cell', { name: /Račun 17-2027\.pdf/ }).last().waitFor();
    await a11y.scan(page, 'trošak: dokazi');
  });
  await step('ZNS RP1: popis za provjeru, rana predaja s razlogom', async () => {
    // WP1.22 – financije samo tipkovnicom: kartica ZNS strelicama, „Otvori zahtjev” i popis za provjeru (Enter).
    await page.getByRole('tab', { name: 'Troškovi', selected: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('tab', { name: 'Zahtjevi za nadoknadu', selected: true }).waitFor();
    await a11y.tabTo(page, 'Otvori zahtjev', { label: 'ZNS' });
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: /ZNS za RP1/ }).waitFor();
    await page.getByRole('cell', { name: 'dokaz (1)' }).waitFor();
    await a11y.scan(page, 'ZNS: nacrt s popisom za provjeru');
    await page.getByText(/2\.856,50/).first().waitFor(); // 310 + 2.500 + 15 % od 310 = 2.856,50
    await page.getByRole('cell', { name: 'dokaz (1)' }).waitFor();
    // Troškovi osoblja grupirani po osobi i mjesecu; redak po radnom paketu na klik.
    await a11y.tabTo(page, /Rad: Ivana Horvat, velj\. 2027\./, { label: 'ZNS', max: 200 });
    await page.keyboard.press('Enter');
    await page.getByRole('cell', { name: /WP1/ }).first().waitFor();
    // Projekt počinje 2027-01-01: razdoblje još traje – predaja tek uz razlog rane predaje.
    await page.getByText(/Razdoblje još traje/).waitFor();
    const submit = page.getByRole('button', { name: 'Predaj zahtjev' });
    if (await submit.isEnabled()) throw new Error('predaja bez razloga rane predaje ne smije biti moguća');
    await page.getByLabel(/Razlog rane predaje/).fill('E2E: provjera rane predaje');
    await page.getByLabel('Sati utrošeni na pripremu').fill('3,5');
    await submit.click();
    await page.locator('h2 .chip', { hasText: 'predan' }).waitFor();
    await page.getByText('Predan prije kraja razdoblja. Razlog: E2E: provjera rane predaje').waitFor();
    await shot('zns');
  });
  await step('ZNS RP1: odluka po trošku (umanjenje s razlogom) i isplata', async () => {
    await page.getByLabel('Priznato: Anketno istraživanje').fill('2.000,00');
    await page.getByText(/razlog je obavezan/).waitFor(); // pregled s poslužitelja traži razlog
    await page.getByLabel('Razlog: Anketno istraživanje').fill('Priznato prema ugovoru s agencijom');
    await page.locator('.tile', { hasText: 'priznato (izračun)' }).getByText('2.356,50').waitFor(); // 310 + 2.000 + 46,50
    await page.getByRole('button', { name: 'Spremi odluku' }).click();
    await page.locator('h2 .chip', { hasText: 'djelomično odobren' }).waitFor();
    await page.locator('.tile', { hasText: 'nepriznato' }).getByText('500,00').first().waitFor();
    await page.getByText('Razlog: Priznato prema ugovoru s agencijom').waitFor();
    await page.getByRole('button', { name: 'Zabilježi isplatu' }).click();
    await page.getByText(/isplaćeno 2\.356,50/).waitFor();
    await a11y.scan(page, 'ZNS: odlučen i isplaćen');
    await shot('zns-odluka');
  });
  await step('ZNS RP1: paket za predaju (ZIP) i mjerenje pripreme', async () => {
    await page.getByText(/3,5 h pripreme/).waitFor();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Preuzmi paket za predaju (ZIP)' }).first().click()]);
    if (!/^ZNS_E2E[0-9a-z]+_RP1_\d{4}-\d{2}-\d{2}\.zip$/i.test(dl.suggestedFilename())) throw new Error(`preuzeto: ${dl.suggestedFilename()}`);
    const head = require('node:fs').readFileSync(await dl.path()).subarray(0, 2).toString();
    if (head !== 'PK') throw new Error('preuzeta datoteka nije ZIP');
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
    await a11y.scan(page, 'projekt: dokumenti');
    await shot('dokumenti');
  });
  await step('ugovoreno / ostvareno', async () => {
    await page.getByRole('tab', { name: 'Ugovoreno / ostvareno' }).click();
    await page.getByText('iskorištenost proračuna').waitFor();
    await a11y.scan(page, 'projekt: ugovoreno / ostvareno');
    await shot('financije');
  });
  await step('uvoz iz Excela: predložak, greške po retku, pregled s upozorenjem, potvrda, podaci vidljivi, povijest', async () => {
    // Radna knjiga vlastitim XLSX pisačem API-ja (izgrađen u run-local.sh) – isti format kao predložak.
    const { buildXlsx } = require('../../api/dist/export/xlsx-writer');
    const head = ['Datum', 'Kategorija', 'Radni paket', 'Opis', 'Iznos (EUR)', 'Potraživano izvan sustava', 'Razdoblje / ZNS'];
    const book = (cat) => buildXlsx({ sheets: [
      { name: 'Radni paketi', rows: [['Naziv', 'Početni mjesec', 'Završni mjesec'], ['Diseminacija rezultata', 1, 12]] },
      { name: 'Troškovi', rows: [head, [{ v: '2027-02-20', s: 'date' }, cat, 2, 'Tisak letaka (uvoz)', 120, 'NE', null], [{ v: '2027-01-20', s: 'date' }, 'PUT', 1, 'Putovanje – prije ArQusa', 80, 'DA', 'ZNS 0 (papirnato)']] },
    ] });
    await page.getByRole('tab', { name: 'Uvoz' }).click();
    await page.getByRole('heading', { name: 'Uvoz postojećeg projekta iz Excela' }).waitFor();
    await a11y.scan(page, 'projekt: uvoz');
    const [tpl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Preuzmi predložak za ovaj projekt' }).click()]);
    if (!/^Uvoz_E2E[0-9a-z_-]+_predlozak\.xlsx$/i.test(tpl.suggestedFilename())) throw new Error(`predložak: ${tpl.suggestedFilename()}`);
    const file = page.getByLabel(/Ispunjena datoteka/);
    await file.setInputFiles({ name: 'projekt-greska.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await book('XX') });
    await page.getByRole('button', { name: 'Provjeri datoteku' }).click();
    await page.getByText('Ništa još nije spremljeno.').waitFor();
    await page.getByRole('heading', { name: 'Greške', exact: true }).waitFor();
    await page.getByRole('cell', { name: /kategorija ne postoji u paketu programa/ }).waitFor();
    await a11y.scan(page, 'uvoz: greške po retku');
    if (await page.getByRole('button', { name: 'Potvrdi uvoz' }).isEnabled()) throw new Error('uvoz s greškama ne smije se moći potvrditi');
    await shot('uvoz-greske');
    await file.setInputFiles({ name: 'projekt.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await book('VU') });
    await page.getByRole('button', { name: 'Provjeri datoteku' }).click();
    await page.getByText(/Datoteka je valjana, uz \d+ upozorenj/).waitFor();
    const confirm = page.getByRole('button', { name: 'Potvrdi uvoz' });
    if (await confirm.isEnabled()) throw new Error('upozorenja se moraju potvrditi');
    await page.getByLabel(/Pročitao\/la sam/).check();
    await shot('uvoz-pregled');
    await confirm.click();
    await page.getByRole('heading', { name: 'Uvoz je spremljen' }).waitFor();
    await page.locator('table.import-history').getByText('primijenjen').waitFor();
    await shot('uvoz-rezultat');
    await page.getByRole('link', { name: 'Otvori: Troškovi →' }).click();
    await page.getByRole('cell', { name: 'Putovanje – prije ArQusa' }).waitFor();
    await page.getByText('potraživan izvan sustava').first().waitFor();
    await page.getByRole('cell', { name: 'Tisak letaka (uvoz)' }).waitFor();
    await page.getByRole('tab', { name: 'Struktura rada' }).click();
    await page.getByText('Diseminacija rezultata').first().waitFor();
    await a11y.scan(page, 'projekt: struktura rada');
  });
  await step('portfelj: projekt, potrošnja i rokovi', async () => {
    await page.getByRole('link', { name: 'Portfelj' }).click();
    const row = page.locator('table.portfolio tr', { hasText: `E2E${tag}`.slice(0, 20) });
    await row.getByText('potrošnja').waitFor();
    await row.getByText('nije počeo').waitFor(); // projekt počinje 2027-01-01
    await page.getByRole('heading', { name: 'Rokovi' }).waitFor();
    await page.getByRole('heading', { name: 'Opterećenje ljudi' }).waitFor();
    await a11y.scan(page, 'portfelj');
    await row.getByRole('link', { name: `E2E${tag}`.slice(0, 20) }).click();
    await page.getByRole('tab', { name: 'Pregled' }).waitFor();
    await shot('portfelj');
  });
  await step('revizija: tko je što promijenio – filtri, prije/poslije, izvoz u CSV', async () => {
    await page.getByRole('link', { name: 'Prijave' }).click();
    await page.getByRole('heading', { name: 'Prijave' }).waitFor();
    await a11y.scan(page, 'prijave');
    await page.getByRole('link', { name: 'Projekti', exact: true }).click();
    await page.getByRole('heading', { name: 'Projekti', level: 1 }).waitFor();
    await page.getByRole('cell', { name: new RegExp(`E2E${tag}`.slice(0, 20)) }).first().waitFor();
    await a11y.scan(page, 'projekti');
    await page.getByRole('link', { name: 'Revizija' }).click();
    await page.getByRole('heading', { name: 'Revizija' }).waitFor();
    await page.locator('table.audit-table tbody tr').first().waitFor();
    const filters = page.getByRole('form', { name: 'Filtri revizije' });
    await filters.getByLabel('Vrsta zapisa', { exact: true }).selectOption({ label: 'proračun projekta' });
    await filters.getByLabel('Korisnik', { exact: true }).selectOption({ label: 'Iva Ured' });
    await page.getByRole('button', { name: 'Primijeni filtre' }).click();
    const row = page.locator('table.audit-table tbody tr', { hasText: 'izmjena proračuna' }).first();
    await row.getByText('Iva Ured').waitFor();
    await row.getByRole('button', { name: 'Prikaži prije / poslije' }).click();
    await page.locator('.audit-changes').getByText('poslije').first().waitFor();
    await page.locator('.audit-changes').getByText(/34\.150,00/).first().waitFor();
    await a11y.scan(page, 'revizija');
    await shot('revizija');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Izvoz u CSV' }).click()]);
    if (!/^revizija_\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename())) throw new Error(`preuzeto: ${dl.suggestedFilename()}`);
    const csv = require('node:fs').readFileSync(await dl.path());
    if (csv[0] !== 0xef || csv[1] !== 0xbb || csv[2] !== 0xbf) throw new Error('CSV bez BOM-a');
    const lines = csv.toString('utf8').replace(/^\uFEFF/, '').trim().split('\r\n');
    if (!lines[0].startsWith('id;vrijeme;korisnik') || lines.length < 2 || !lines.slice(1).every((l) => l.includes(';Iva Ured;') && l.includes(';project_budget;'))) throw new Error(`neočekivan CSV: ${lines.slice(0, 3).join(' | ')}`);
  });
  const newEmail = `ana.${tag}@e2e.local`; const newPw = `plava-staza-${tag}-uz-more`;
  const acronym = `E2E${tag}`.slice(0, 20);
  await step('pozivnica (administrator, bez e-pošte): poveznica jednom, korisnik sam bira lozinku', async () => {
    await page.getByRole('link', { name: 'Korisnici' }).click();
    const form = page.locator('.card', { hasText: 'Pozovi korisnika' });
    await form.waitFor();
    await a11y.scan(page, 'korisnici');
    if (await form.getByLabel(/lozinka/i).count()) throw new Error('obrazac pozivnice ne smije imati polje lozinke');
    // WP1.22 – administrator poziva korisnika samo tipkovnicom (Tab, upis, odabir projekta upisom, Enter).
    await a11y.tabTo(page, 'Ime i prezime', { label: 'pozivnica', max: 80 }); await page.keyboard.type('Ana Novak');
    await a11y.tabTo(page, 'E-adresa', { label: 'pozivnica' }); await page.keyboard.type(newEmail);
    await a11y.tabTo(page, 'Projekt', { label: 'pozivnica' });
    const projectSelect = form.getByLabel(/^Projekt/);
    const wanted = await projectSelect.locator('option', { hasText: `${acronym} – Projekt iz e2e testa` }).getAttribute('value');
    for (let i = 0; i < 400 && (await projectSelect.inputValue()) !== wanted; i++) await page.keyboard.press('ArrowDown'); // strelice mijenjaju odabir zatvorenog popisa
    if ((await projectSelect.inputValue()) !== wanted) throw new Error('projekt nije odabran tipkovnicom');
    await a11y.tabTo(page, 'Pošalji pozivnicu', { label: 'pozivnica' });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Poveznica pozivnice' });
    await dialog.waitFor();
    await dialog.getByText(/pouzdanim kanalom/).waitFor();
    // Dijalog: fokus u dijalogu pri otvaranju, Tab ne izlazi iz njega, Escape zatvara i vraća fokus na gumb koji ga je otvorio.
    if (!(await a11y.describeFocus(page))?.inDialog) throw new Error('fokus nije u dijalogu nakon otvaranja');
    await a11y.assertFocusInDialog(page);
    await a11y.scan(page, 'korisnici: dijalog s poveznicom');
    const link = await dialog.getByTestId('handover-link').inputValue();
    if (!link.startsWith(`${new URL(WEB).origin}/#/pozivnica/`)) throw new Error(`poveznica: ${link}`);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await dialog.getByRole('button', { name: /Kopiraj/ }).click();
    await shot('pozivnica-poveznica');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    if ((await a11y.describeFocus(page))?.name !== 'Pošalji pozivnicu') throw new Error('nakon zatvaranja dijaloga fokus se nije vratio na gumb koji ga je otvorio');
    const row = page.locator('tr', { hasText: newEmail });
    await row.getByText('pozvan', { exact: true }).waitFor();
    await row.getByText(/pozivnica do .* ručno/).waitFor();
    await page.getByText(`Član tima · ${acronym}`).waitFor();
    // Pozvani korisnik otvara poveznicu u svojem pregledniku.
    const { ctx, p, urls, bodies } = await freshContext('pozvana');
    await p.goto(link);
    await p.getByText('Prihvaćanje pozivnice').waitFor();
    await p.getByText(/Dobrodošao\/la, Ana Novak/).waitFor();
    await a11y.scan(p, 'pozivnica: prihvaćanje');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/pozivnica-prihvacanje.png`, fullPage: true });
    await p.getByLabel(/^Lozinka/).fill('kratka');
    await p.getByLabel('Ponovi lozinku').fill('kratka');
    await p.getByRole('button', { name: 'Postavi lozinku i prijavi se' }).click();
    await p.getByText('Lozinka ne zadovoljava pravila').waitFor(); // politika lozinki kao drugdje
    await a11y.scan(p, 'pozivnica: greška u obrascu');
    await p.getByLabel(/^Lozinka/).fill(newPw);
    await p.getByLabel('Ponovi lozinku').fill(newPw);
    await p.getByRole('button', { name: 'Postavi lozinku i prijavi se' }).click();
    await p.getByRole('heading', { name: 'Moj rad' }).waitFor();
    if (p.url().includes(link.split('/').pop())) throw new Error('token ostaje u adresnoj traci nakon prihvaćanja');
    assertTokenOnlyInBody(link.split('/').pop(), urls, bodies);
    // Iskorištena poveznica: jasna slijepa ulica.
    await p.goto(link);
    await p.getByTestId('link-invalid').waitFor();
    await a11y.scan(p, 'poveznica nije valjana');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/poveznica-nevaljana.png`, fullPage: true });
    await ctx.close();
    await page.reload();
    await page.locator('tr', { hasText: newEmail }).getByText('aktivan', { exact: true }).waitFor();
  });
  await step('zaboravljena lozinka: isti odgovor za postojeći i nepostojeći račun (bez e-pošte upućuje na administratora)', async () => {
    const { ctx, p } = await freshContext('zaboravljena');
    const ask = async (email) => {
      await p.goto(WEB);
      await p.getByRole('button', { name: 'Zaboravljena lozinka?' }).click();
      if (email === newEmail) await a11y.scan(p, 'zaboravljena lozinka');
      await p.getByLabel('Institucija (oznaka)').fill(SLUG);
      await p.getByLabel('E-adresa').fill(email);
      await p.getByRole('button', { name: 'Pošalji poveznicu' }).click();
      return (await p.getByTestId('forgot-done').innerText()).trim();
    };
    const known = await ask(newEmail);
    await a11y.scan(p, 'zaboravljena lozinka: odgovor');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/zaboravljena-lozinka.png`, fullPage: true });
    const unknown = await ask(`nitko.${tag}@e2e.local`);
    if (known !== unknown) throw new Error(`odgovori se razlikuju:\n${known}\n---\n${unknown}`);
    if (!/ne šalje e-poštu/.test(known)) throw new Error('bez e-pošte poruka mora uputiti na administratora');
    await ctx.close();
  });
  await step('pristup projektu: korisnik s ulogom na projektu', async () => {
    await page.getByRole('link', { name: 'Projekti' }).click();
    await page.getByRole('cell', { name: new RegExp(acronym) }).first().click();
    await page.getByRole('tab', { name: 'Pristup' }).click();
    await page.locator('tr', { hasText: newEmail }).getByText('na ovom projektu').waitFor();
    await a11y.scan(page, 'projekt: pristup');
    await shot('pristup');
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
    await page.getByRole('button', { name: 'Postavi MFA' }).waitFor();
    await a11y.scan(page, 'moj račun');
    await page.getByRole('button', { name: 'Postavi MFA' }).click();
    secret = (await page.locator('code').first().textContent()).trim();
    await a11y.scan(page, 'moj račun: postavljanje MFA');
    await page.getByLabel('Kod iz aplikacije').fill(totp(secret));
    await page.getByRole('button', { name: 'Uključi MFA' }).click();
    await page.getByText('MFA je uključen').waitFor();
    await shot('moj-racun');
  });
  await step('prijava s MFA kodom', async () => {
    await relogin(newEmail, newPw);
    mfaStepUsed = Math.floor(Date.now() / 30000) + 1; // poslužitelj pamti zadnji iskorišteni korak (zaštita od ponovne upotrebe)
    await a11y.scan(page, 'prijava: MFA kod');
    await page.getByLabel('Kod iz aplikacije za autentikaciju').fill(totp(secret, 1));
    await page.getByRole('button', { name: 'Potvrdi kod' }).click();
    await page.getByRole('heading', { name: 'Moj rad' }).waitFor(); // WP1.18: početna stranica člana tima
    await page.locator('.work-group, .work-empty').first().waitFor();
    await a11y.scan(page, 'moj rad: prazno');
  });
  await step('član tima vidi samo svoj projekt i samo dopuštene radnje', async () => {
    await page.getByRole('link', { name: 'Projekti', exact: true }).click();
    await page.getByRole('cell', { name: new RegExp(acronym) }).first().waitFor();
    const rows = await page.locator('tbody tr.row').count();
    if (rows !== 1) throw new Error(`očekivan 1 projekt, vidljivo ${rows}`);
    if (await page.getByRole('link', { name: 'Radar poziva' }).count()) throw new Error('radar ne smije biti u izborniku');
    if (await page.getByRole('button', { name: 'Novi projekt' }).count()) throw new Error('gumb Novi projekt ne smije biti vidljiv');
    await page.getByRole('cell', { name: new RegExp(acronym) }).first().click();
    await page.getByRole('tab', { name: 'Tim i timesheetovi' }).click();
    await page.getByRole('cell', { name: 'Ivana Horvat' }).waitFor();
    if (await page.getByRole('tab', { name: 'Pristup' }).count()) throw new Error('kartica Pristup ne smije biti vidljiva članu tima');
    if (await page.getByRole('button', { name: 'Dodaj člana tima' }).count()) throw new Error('član tima ne dodaje članove');
    await shot('clan-tima');
  });
  // WP1.18: „Moj rad”. Projekt u tijeku (počeo prije dva mjeseca) s voditeljicom ureda kao imenovanom voditeljicom i Anom kao
  // članicom tima s računom. Ana nakon prijave vidi timesheet tekućeg mjeseca, otvara ga iz stavke i predaje; voditeljica ga
  // vidi u svojem „Moj rad”, odobrava i stavka nestaje; Ana u zvoncu dobiva obavijest da je timesheet odobren.
  await step('Moj rad: član tima samo tipkovnicom predaje timesheet iz stavke, voditeljica ga tipkovnicom odobrava, obavijest „odobren”', async () => {
    const zg = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [y, mo] = zg.split('-').map(Number); const start = new Date(Date.UTC(y, mo - 3, 1)).toISOString().slice(0, 10);
    const o = await openOffice();
    const live = `MR${tag}`.slice(0, 20);
    // WP1.22: isporuka trećeg mjeseca projekta (= tekući mjesec, rok kraj mjeseca – „uskoro”) s Anom kao odgovornom osobom.
    const res = await o.evaluate(async ([email, live, start]) => {
      const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('arqus.token')}` };
      const me = await (await fetch('/api/me', { headers: h })).json();
      const ana = (await (await fetch('/api/users', { headers: h })).json()).find((u) => u.email === email);
      const p = await (await fetch('/api/projects', { method: 'POST', headers: h, body: JSON.stringify({ acronym: live, title: 'Projekt u tijeku (Moj rad)', packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', contractNo: `UG-${live}`, startDate: start, durationMonths: 12, managerUserId: me.user.id }) })).json();
      const a = (await fetch(`/api/projects/${p.id}/transition`, { method: 'POST', headers: h, body: JSON.stringify({ to: 'active' }) })).status;
      const t = await fetch(`/api/projects/${p.id}/team`, { method: 'POST', headers: h, body: JSON.stringify({ fullName: 'Ana Novak', userId: ana.id, annualCost: 3_000_000 }) });
      const member = (await t.json()).id;
      const wp = await (await fetch(`/api/projects/${p.id}/work-packages`, { method: 'POST', headers: h, body: JSON.stringify({ title: 'Anketa', startMonth: 1, endMonth: 12 }) })).json();
      const d = (await fetch(`/api/projects/${p.id}/work-packages/${wp.id}/deliverables`, { method: 'POST', headers: h, body: JSON.stringify({ title: 'Izvještaj o anketi', type: 'ISP', dissemination: 'JAV', dueMonth: 3, responsibleMemberId: member }) })).status;
      return `${a} ${t.status} ${d}`;
    }, [newEmail, live, start]);
    if (res !== '201 201 201') throw new Error(`projekt za Moj rad: ${res}`);
    // Ana (prijavljena) – nova uloga na projektu vrijedi odmah; „Moj rad” je početna stranica.
    const t0 = Date.now();
    await page.goto(WEB);
    await page.getByRole('heading', { name: 'Moj rad' }).waitFor();
    const item = page.locator('a.work-item[data-kind="timesheet_current"]', { hasText: live });
    await item.getByText('nije započet').waitFor();
    await page.locator('a.work-item[data-kind="deliverable_responsible"]', { hasText: live }).getByText(/ti si odgovorna osoba/).waitFor();
    // Ana je u tim upisana danas – raniji mjeseci projekta od nje se ne traže (pravilo „od kasnijeg od početka i ulaska u tim”).
    if (await page.locator('a.work-item[data-kind="timesheet_missing"]', { hasText: live }).count()) throw new Error('mjeseci prije ulaska u tim ne smiju se tražiti');
    await a11y.scan(page, 'moj rad: član tima');
    await shot('moj-rad-clan');
    // Samo tipkovnicom: stavka → Enter → sati → Spremi → Predaj.
    await a11y.tabTo(page, (d) => d.tag === 'a' && d.name.includes(live) && d.name.includes('nije započet'), { label: 'Moj rad (član tima)' });
    await page.keyboard.press('Enter');
    await page.getByLabel('Bez radnog paketa dan 1', { exact: true }).waitFor();
    await a11y.tabTo(page, 'Bez radnog paketa dan 1', { label: 'timesheet', max: 200 });
    await page.keyboard.type('6');
    await a11y.tabTo(page, 'Spremi', { label: 'timesheet', max: 200 });
    await page.keyboard.press('Enter');
    await page.getByText('ukupno 6 h').waitFor();
    await page.getByRole('button', { name: 'Predaj na odobrenje' }).waitFor(); // gumb se pojavljuje kad je nacrt spremljen; fokus ostaje na „Spremi”
    await a11y.tabTo(page, 'Predaj na odobrenje', { label: 'timesheet', max: 20 });
    await page.keyboard.press('Enter');
    await page.locator('h3 .chip', { hasText: 'predan' }).waitFor();
    process.stdout.write(`(predano za ${Math.round((Date.now() - t0) / 1000)} s) `);
    await page.getByRole('link', { name: /^Moj rad/ }).click();
    await page.locator('a.work-item[data-kind="timesheet_submitted"]', { hasText: live }).waitFor();
    // Voditeljica: stavka odobrenja u „Moj rad” (i tko je odgovoran za isporuku), odobrenje tipkovnicom, stavka nestaje.
    await o.goto(`${WEB}/#/moj-rad`);
    const approve = o.locator('a.work-item[data-kind="timesheet_to_approve"]', { hasText: 'Ana Novak' });
    await approve.waitFor();
    await o.locator('a.work-item[data-kind="deliverable_due"]', { hasText: live }).getByText('odgovorna osoba: Ana Novak').waitFor();
    await a11y.scan(o, 'moj rad: voditelj');
    if (SHOTS) await o.screenshot({ path: `${SHOTS}/moj-rad-voditelj.png`, fullPage: true });
    await a11y.tabTo(o, (d) => d.tag === 'a' && /Odobri timesheet: Ana Novak/.test(d.name) && d.name.includes(live), { label: 'Moj rad (voditelj)' });
    await o.keyboard.press('Enter');
    await o.getByRole('button', { name: /Odobri/ }).waitFor();
    await a11y.tabTo(o, /^Odobri/, { label: 'odobrenje', max: 200 });
    await o.keyboard.press('Enter');
    await o.locator('h3 .chip', { hasText: 'odobren' }).waitFor();
    await o.getByRole('link', { name: /^Moj rad/ }).click();
    await o.getByRole('heading', { name: 'Moj rad' }).waitFor();
    await o.locator('.work-group, .work-empty').first().waitFor();
    if (await o.locator('a.work-item[data-kind="timesheet_to_approve"]', { hasText: 'Ana Novak' }).count()) throw new Error('odobren timesheet mora nestati s popisa voditeljice');
    // Ana: obavijest u zvoncu – izbornik obavijesti tipkovnicom (Enter otvara, Escape zatvara i vraća fokus na zvonce).
    await page.reload();
    await page.getByRole('heading', { name: 'Moj rad' }).waitFor();
    await a11y.tabTo(page, /^Obavijesti – \d+ nepročitan/, { label: 'obavijesti' });
    await page.keyboard.press('Enter');
    await page.locator('.dropdown .note', { hasText: /je odobren/ }).filter({ hasText: live }).waitFor();
    await page.locator('.dropdown .note', { hasText: /Odgovoran\/na si za isporuku/ }).filter({ hasText: live }).waitFor();
    await a11y.scan(page, 'obavijesti (otvoren izbornik)', { widths: [1400], reflow: false });
    await a11y.tabTo(page, (d) => d.tag === 'button' && /je odobren/.test(d.name), { label: 'obavijesti', max: 20 });
    await page.keyboard.press('Escape');
    if (await page.locator('.dropdown').count()) throw new Error('Escape mora zatvoriti izbornik obavijesti');
    if (!/^Obavijesti/.test((await a11y.describeFocus(page))?.name ?? '')) throw new Error('nakon Escape fokus se mora vratiti na zvonce');
    await page.getByRole('button', { name: /^Obavijesti/ }).click();
    await shot('obavijesti');
    await page.locator('.dropdown .note', { hasText: /je odobren/ }).filter({ hasText: live }).click();
    await page.locator('h3 .chip', { hasText: 'odobren' }).waitFor();
  });
  // WP1.22: odgovorna osoba otvara svoju isporuku iz „Moj rad” i pomiče je kroz radni dio statusa; vidi sebe kao odgovornu.
  await step('Moj rad: odgovorna osoba otvara isporuku i pomiče je (u izradi → predana); voditeljica vidi tko je odgovoran', async () => {
    const live = `MR${tag}`.slice(0, 20);
    await page.getByRole('link', { name: /^Moj rad/ }).click();
    const it = page.locator('a.work-item[data-kind="deliverable_responsible"]', { hasText: live });
    await it.waitFor();
    await it.focus(); await page.keyboard.press('Enter');
    const row = page.locator('tr[data-deliverable]', { hasText: 'Izvještaj o anketi' });
    await row.getByText('Ana Novak (ti)').waitFor();
    if (await row.getByRole('combobox').count()) throw new Error('odgovorna osoba ne uređuje strukturu (odabir statusa i osobe)');
    await a11y.scan(page, 'struktura: odgovorna osoba');
    await row.getByRole('button', { name: /označi kao u izradi/ }).click();
    await row.locator('.chip', { hasText: 'u izradi' }).waitFor();
    await row.getByRole('button', { name: /označi kao predana/ }).click();
    await row.locator('.chip', { hasText: 'predana' }).waitFor();
    if (await row.getByRole('button', { name: /označi kao/ }).count()) throw new Error('nakon predaje odgovorna osoba nema daljnjih koraka (prihvaćanje je na voditelju)');
    await shot('odgovorna-osoba-struktura');
    await page.getByRole('link', { name: /^Moj rad/ }).click();
    await page.getByRole('heading', { name: 'Moj rad' }).waitFor();
    await page.locator('.work-group, .work-empty').first().waitFor();
    if (await page.locator('a.work-item[data-kind="deliverable_responsible"]', { hasText: live }).count()) throw new Error('predana isporuka mora nestati iz „Moj rad”');
  });
  // WP1.19: obvezni MFA. Administrator uključi vlastiti MFA i postroži postavku institucije; voditeljica ureda (povlaštena uloga,
  // bez MFA) u otvorenoj sesiji odmah dobiva samo postavljanje MFA s objašnjenjem, nakon postavljanja radi normalno.
  let adminSecret = '';
  await step('obvezni MFA: administrator postroži postavku, ured odmah na postavljanje MFA', async () => {
    await relogin(EMAIL, PW);
    await page.getByRole('heading', { name: 'Portfelj' }).waitFor();
    await page.getByRole('link', { name: /Administrator/ }).click();
    await page.getByRole('button', { name: 'Postavi MFA' }).click();
    adminSecret = (await page.locator('code').first().textContent()).trim();
    await page.getByLabel('Kod iz aplikacije').fill(totp(adminSecret));
    await page.getByRole('button', { name: 'Uključi MFA' }).click();
    await page.getByText('MFA je uključen').waitFor();
    await page.getByRole('link', { name: 'Korisnici' }).click();
    const card = page.locator('.card', { hasText: 'Obvezna dvofaktorska prijava (MFA)' });
    await card.getByLabel(/Obvezna za povlaštene uloge/).check();
    await card.getByText(/još nema MFA i pri sljedećem zahtjevu/).waitFor();
    await card.getByRole('button', { name: 'Spremi postavku' }).click();
    await page.locator('tr', { hasText: officeEmail }).getByText('obvezan – nije postavljen').waitFor();
    const o = await openOffice();
    await o.reload();
    await o.getByRole('heading', { name: 'Postavi dvofaktorsku prijavu' }).waitFor();
    await o.getByText(/Tvoja institucija zahtijeva dvofaktorsku prijavu/).waitFor();
    await a11y.scan(o, 'obvezni MFA');
    if (await o.locator('header nav').count()) throw new Error('u ograničenom stanju izbornik ne smije biti dostupan');
    // Poslužitelj odbija i izravne zahtjeve (ne samo sučelje).
    const blocked = await o.evaluate(async () => { const r = await fetch('/api/projects', { headers: { Authorization: `Bearer ${sessionStorage.getItem('arqus.token')}` } }); return `${r.status} ${(await r.json()).code}`; });
    if (blocked !== '403 mfa_setup_required') throw new Error(`izravni zahtjev u ograničenom stanju: ${blocked}`);
    if (SHOTS) await o.screenshot({ path: `${SHOTS}/obvezni-mfa.png`, fullPage: true });
    await o.getByRole('button', { name: 'Postavi MFA' }).click();
    const s2 = (await o.locator('code').first().textContent()).trim();
    await o.getByLabel('Kod iz aplikacije').fill(totp(s2));
    await o.getByRole('button', { name: 'Uključi MFA' }).click();
    await o.locator('header nav').getByRole('link', { name: 'Projekti', exact: true }).waitFor(); // puni izbornik – sesija više nije ograničena
    if (await o.getByRole('heading', { name: 'Postavi dvofaktorsku prijavu' }).count()) throw new Error('nakon postavljanja MFA sesija mora biti otključana');
  });
  // WP1.19: uprava (čitatelj, finance:read bez personnel:read) vidi sate, ne iznose troškova osoblja; zbroj kategorije ostaje.
  await step('troškovi osoblja: bez prava na plaće sati da, iznos ne', async () => {
    const readerEmail = `uprava.${tag}@e2e.local`; const readerPw = `crvena-staza-${tag}-uz-rijeku`;
    const status = await apiInvite(readerEmail, 'Uprava Čitatelj', ['reader'], readerPw);
    if (status !== 201) throw new Error(`čitatelj nije stvoren (${status})`);
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const r = await ctx.newPage();
    r.on('pageerror', (e) => problems.push(`pageerror (uprava): ${e.message}`));
    await r.goto(WEB);
    await r.getByLabel('Institucija (oznaka)').fill(SLUG);
    await r.getByLabel('E-adresa').fill(readerEmail);
    await r.getByLabel('Lozinka').fill(readerPw);
    await r.getByRole('button', { name: 'Prijava' }).click();
    await r.getByRole('heading', { name: 'Portfelj' }).waitFor(); // čitatelj nije povlašten – bez obveznog MFA
    await r.getByRole('link', { name: 'Projekti' }).click();
    await r.getByRole('cell', { name: new RegExp(acronym) }).first().click();
    await r.getByRole('tab', { name: 'Troškovi' }).click();
    await r.getByText(/Iznosi troškova osoblja \(plaće\) vidljivi su samo uz pristup podacima o osoblju/).waitFor();
    const personnel = r.locator('tr', { hasText: 'Rad: Ivana Horvat' }).first();
    await personnel.getByText('skriveno').first().waitFor();
    if (await r.getByText(/310,00/).count()) throw new Error('iznos troška osoblja ne smije biti vidljiv bez personnel:read');
    await r.getByRole('cell', { name: 'Anketno istraživanje' }).waitFor(); // ručni trošak s iznosom
    if (SHOTS) await r.screenshot({ path: `${SHOTS}/troskovi-bez-place.png`, fullPage: true });
    await ctx.close();
  });
  await step('poveznica za novu lozinku (administrator): korisnik postavlja lozinku, prijava novom lozinkom i MFA kodom', async () => {
    await page.getByRole('link', { name: 'Korisnici' }).click();
    await page.locator('tr', { hasText: newEmail }).getByRole('button', { name: 'poveznica za novu lozinku' }).click();
    const dialog = page.getByRole('dialog', { name: 'Poveznica za novu lozinku' });
    await dialog.waitFor();
    const link = await dialog.getByTestId('handover-link').inputValue();
    if (!link.includes('/#/lozinka/')) throw new Error(`poveznica: ${link}`);
    await dialog.getByRole('button', { name: 'Zatvori' }).click();
    const { ctx, p, urls, bodies } = await freshContext('nova lozinka');
    await p.goto(link);
    await p.getByText(`Odaberi novu lozinku za račun ${newEmail}`).waitFor();
    await a11y.scan(p, 'nova lozinka');
    const fresh = `nova-staza-${tag}-kroz-sumu`;
    await p.getByLabel('Nova lozinka').fill(fresh);
    await p.getByLabel('Ponovi lozinku').fill(fresh);
    await p.getByRole('button', { name: 'Postavi novu lozinku' }).click();
    await p.getByTestId('reset-done').waitFor();
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/nova-lozinka-gotovo.png`, fullPage: true });
    assertTokenOnlyInBody(link.split('/').pop(), urls, bodies);
    await p.getByRole('button', { name: 'Na prijavu' }).click();
    await p.getByLabel('E-adresa').fill(newEmail);
    await p.getByLabel('Lozinka').fill(newPw);
    await p.getByRole('button', { name: 'Prijava' }).click();
    await p.getByText('Pogrešni podaci za prijavu').waitFor(); // stara lozinka više ne vrijedi
    await p.getByLabel('Lozinka').fill(fresh);
    await p.getByRole('button', { name: 'Prijava' }).click();
    // Nova lozinka ne zaobilazi MFA: traži se kod. Poslužitelj prihvaća samo korak NOVIJI od zadnjeg iskorištenog (ranija
    // prijava ovog korisnika potrošila je korak „sada + 1”), pa se čeka da sat prijeđe u taj korak (najviše ~30 s) i šalje
    // kod sljedećeg koraka – neovisno o tome koliko su prethodni koraci testa trajali.
    while (Math.floor(Date.now() / 30000) < mfaStepUsed) await p.waitForTimeout(500);
    await p.getByLabel('Kod iz aplikacije za autentikaciju').fill(totp(secret, 1));
    await p.getByRole('button', { name: 'Potvrdi kod' }).click();
    await p.getByRole('heading', { name: 'Moj rad' }).waitFor();
    await ctx.close();
  });
  // Testna baza se ponovno koristi: postavka natrag na „nije obvezna”, administrator bez MFA (ponovljivo pokretanje).
  await step('vraćanje postavki MFA', async () => {
    const res = await page.evaluate(async (code) => {
      const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('arqus.token')}` };
      const a = (await fetch('/api/tenant/security', { method: 'PUT', headers: h, body: JSON.stringify({ requireMfa: 'none' }) })).status;
      const b = (await fetch('/api/me/mfa/disable', { method: 'POST', headers: h, body: JSON.stringify({ code }) })).status;
      return `${a} ${b}`;
    }, totp(adminSecret, 1));
    if (res !== '200 201') throw new Error(`vraćanje postavki: ${res}`);
  });
  // WP1.23: osobni podaci. Javna stranica „Privatnost”; istraživačica preuzima vlastite podatke; administrator joj izvozi
  // podatke, otvara pregled anonimizacije (ne potvrđuje – rok čuvanja projekta traje) i zatvara račun; rokovi čuvanja.
  await step('privatnost: javna stranica bez prijave (poveznica u podnožju)', async () => {
    const { ctx, p } = await freshContext('privatnost');
    await p.goto(WEB);
    await p.getByRole('contentinfo').getByRole('link', { name: 'Privatnost' }).click();
    await p.getByRole('heading', { name: 'Privatnost', level: 1 }).waitFor();
    await p.getByText(/je voditelj obrade/).waitFor();
    await a11y.scan(p, 'privatnost (bez prijave)');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/privatnost.png`, fullPage: true });
    await ctx.close();
  });
  let leaverPage = null;
  const leaverEmail = `bivsa.${tag}@e2e.local`; const leaverPw = `ljubicasta-staza-${tag}-uz-more`;
  await step('Moj račun: korisnica preuzima vlastite podatke (ZIP)', async () => {
    const status = await apiInvite(leaverEmail, 'Lucija Bivšić', [], leaverPw);
    if (status !== 201) throw new Error(`korisnica nije stvorena (${status})`);
    const linked = await page.evaluate(async ([email, acronym]) => {
      const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('arqus.token')}` };
      const u = (await (await fetch('/api/users', { headers: h })).json()).find((x) => x.email === email);
      const p = (await (await fetch('/api/projects', { headers: h })).json()).find((x) => x.acronym === acronym);
      return (await fetch(`/api/projects/${p.id}/team`, { method: 'POST', headers: h, body: JSON.stringify({ fullName: 'Lucija Bivšić', userId: u.id, role: 'istraživačica' }) })).status;
    }, [leaverEmail, acronym]);
    if (linked !== 201) throw new Error(`član tima: ${linked}`);
    const { ctx, p } = await freshContext('moji podaci');
    await p.goto(WEB);
    await p.getByLabel('Institucija (oznaka)').fill(SLUG);
    await p.getByLabel('E-adresa').fill(leaverEmail);
    await p.getByLabel('Lozinka').fill(leaverPw);
    await p.getByRole('button', { name: 'Prijava' }).click();
    await p.getByRole('heading', { name: 'Moj rad' }).waitFor();
    await p.getByRole('link', { name: /Lucija Bivšić/ }).click();
    await p.getByRole('heading', { name: 'Moji podaci' }).waitFor();
    await a11y.scan(p, 'moj račun: moji podaci');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Preuzmi moje podatke (ZIP)' }).click()]);
    if (!/^Osobni-podaci_Lucija-Bivsic_\d{4}-\d{2}-\d{2}\.zip$/.test(dl.suggestedFilename())) throw new Error(`preuzeto: ${dl.suggestedFilename()}`);
    if (require('node:fs').readFileSync(await dl.path()).subarray(0, 2).toString() !== 'PK') throw new Error('preuzeta datoteka nije ZIP');
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/moji-podaci.png`, fullPage: true });
    leaverPage = { ctx, p };
  });
  await step('Osobni podaci: administrator izvozi podatke osobe, otvara pregled anonimizacije i zatvara račun', async () => {
    await page.getByRole('navigation', { name: 'Glavni izbornik' }).getByRole('link', { name: 'Osobni podaci' }).click();
    await page.getByRole('heading', { name: 'Osobni podaci', level: 1 }).waitFor();
    await a11y.scan(page, 'osobni podaci');
    await page.getByLabel('Ime, prezime ili e-adresa').fill(leaverEmail); // e-adresa je jedinstvena i pri ponovljenom pokretanju nad istom bazom
    await page.getByRole('button', { name: 'Traži' }).click();
    await page.getByRole('button', { name: 'Odaberi račun Lucija Bivšić' }).click();
    const card = page.locator('.privacy-subject');
    await card.getByText('povezan s računom').waitFor();
    await a11y.scan(page, 'osobni podaci: osoba');
    await shot('osobni-podaci-osoba');
    const [dl] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Preuzmi podatke osobe (ZIP)' }).click()]);
    if (require('node:fs').readFileSync(await dl.path()).subarray(0, 2).toString() !== 'PK') throw new Error('izvoz nije ZIP');
    // Pregled anonimizacije: rok čuvanja projekta još nije počeo – pregled to kaže, ne potvrđujemo.
    await card.getByRole('button', { name: /^Anonimiziraj zapis Lucija Bivšić/ }).click();
    const anon = page.getByRole('dialog', { name: 'Anonimizacija zapisa člana tima' });
    await anon.getByText(/Rok čuvanja još nije počeo/).waitFor();
    await a11y.assertFocusInDialog(page);
    await a11y.scan(page, 'osobni podaci: pregled anonimizacije (dijalog)');
    await shot('anonimizacija-pregled');
    await anon.getByRole('button', { name: 'Odustani' }).click();
    await card.getByRole('button', { name: 'Zatvori račun…' }).click();
    const close = page.getByRole('dialog', { name: 'Zatvoriti račun: Lucija Bivšić?' });
    await close.waitFor();
    await a11y.scan(page, 'osobni podaci: zatvaranje računa (dijalog)');
    await close.getByLabel('Razlog (bilježi se u reviziju)').fill('Istraživačica je otišla s instituta');
    await close.getByLabel(/Za potvrdu upiši ime i prezime/).fill('Lucija Bivšić');
    await close.getByRole('button', { name: 'Zatvori račun' }).click();
    await card.locator('.chip', { hasText: 'zatvoren' }).waitFor();
    await shot('osobni-podaci-zatvoren');
    // Njezina otvorena sesija više ne vrijedi; prijava više nije moguća.
    const st = await leaverPage.p.evaluate(async () => (await fetch('/api/me', { headers: { Authorization: `Bearer ${sessionStorage.getItem('arqus.token')}` } })).status);
    if (st !== 401) throw new Error(`sesija zatvorenog računa: ${st}`);
    const login = await leaverPage.p.evaluate(async ([slug, email, pw]) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantSlug: slug, email, password: pw }) })).status, [SLUG, leaverEmail, leaverPw]);
    if (login !== 401) throw new Error(`prijava zatvorenog računa: ${login}`);
    await leaverPage.ctx.close();
  });
  await step('Osobni podaci: rokovi čuvanja – stvarni brojevi, probno izvođenje bez brisanja', async () => {
    await page.getByRole('tab', { name: 'Rokovi čuvanja' }).click();
    await page.getByRole('heading', { name: 'Rokovi po vrsti podatka' }).waitFor();
    await page.getByText(/Rokovi nisu potvrđeni|Rokove je institucija potvrdila/).waitFor();
    await a11y.scan(page, 'osobni podaci: rokovi čuvanja');
    await page.getByRole('button', { name: 'Probno izvođenje (ništa ne briše)' }).click();
    await page.getByText(/Zadnje probno: \d/).waitFor();
    await shot('rokovi-cuvanja');
  });
  problems.push(...a11y.report());
  await browser.close();
  if (problems.length) { console.error('\nProblemi:\n' + problems.join('\n')); process.exit(1); }
  console.log('\nE2E: sve provjere prošle.');
})().catch((e) => { console.error(e); process.exit(1); });
