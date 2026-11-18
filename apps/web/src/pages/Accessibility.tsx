import { useEffect, useState } from 'react';

/** Datum i verzija samoprocjene (docs/PRISTUPACNOST.md) – mijenjaju se zajedno s izvještajem. */
const ASSESSED = { date: '18. 11. 2026.', version: '0.32.0' };

/**
 * WP1.22 – stranica „Pristupačnost” (dostupna i bez prijave, poveznica u podnožju): čemu proizvod teži, poznata ograničenja
 * jednostavnim jezikom i kako prijaviti prepreku. Ovo je izjava PROIZVODA; zakonsku izjavu o pristupačnosti objavljuje
 * institucija kao tijelo javnog sektora (Zakon o pristupačnosti mrežnih stranica i programskih rješenja za pokretne uređaje
 * tijela javnog sektora) – ova stranica i docs/PRISTUPACNOST.md daju joj podlogu. Kontakt postavlja instalacija
 * (`ACCESSIBILITY_CONTACT`), ne izmišlja se.
 */
export function Accessibility() {
  const [contact, setContact] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch('/api/public/accessibility', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null)).then((d: { contact?: string | null } | null) => { if (live) setContact(d?.contact ?? null); })
      .catch(() => { if (live) setContact(null); });
    return () => { live = false; };
  }, []);
  return (
    <div className="statement">
      <h1>Pristupačnost</h1>
      <p className="sub">Izjava proizvoda ArQus Projekti · samoprocjena {ASSESSED.date}, verzija {ASSESSED.version}</p>
      <div className="card">
        <h2>Čemu težimo</h2>
        <p>ArQus Projekti treba moći koristiti svatko tko u instituciji radi na projektima – i tipkovnicom bez miša, s čitačem zaslona, s povećanim tekstom ili na mobitelu. Mjerilo je norma <b>EN 301 549</b>, odnosno <b>WCAG 2.1 na razini AA</b>, koju za tijela javnog sektora traži Zakon o pristupačnosti mrežnih stranica i programskih rješenja za pokretne uređaje tijela javnog sektora (Direktiva (EU) 2016/2102).</p>
        <h2>Gdje smo</h2>
        <p>Sučelje <b>djelomično zadovoljava</b> WCAG 2.1 AA. To je naša <b>samoprocjena</b>: provjerili smo ga automatskim alatom (axe-core) na svim glavnim zaslonima u svijetloj i tamnoj temi, na računalu i mobitelu, te skriptiranim provjerama rada samo tipkovnicom, fokusa, strukture stranice i prikaza na uskom zaslonu. Sučelje <b>nije</b> isprobala osoba koja svakodnevno koristi čitač zaslona, glasovno upravljanje ili povećalo, niti ga je pregledao neovisni stručnjak – to je sljedeći korak.</p>
        <h2>Poznata ograničenja</h2>
        <ul>
          <li>Čitačem zaslona (NVDA, JAWS, VoiceOver) sučelje još nije provjerila osoba; neki dijelovi mogu se izgovarati nespretno.</li>
          <li>Greške koje javi poslužitelj prikazuju se na vrhu obrasca i čitač ih izgovara, ali nisu uvijek povezane s točnim poljem.</li>
          <li>Velike tablice (timesheet po danima, proračun, ZNS) na mobitelu se pomiču vodoravno unutar svog okvira; timesheet je najlakše ispuniti na računalu.</li>
          <li>Grafički prikazi potrošnje na portfelju imaju i brojčanu vrijednost, ali ne i opis trenda riječima.</li>
          <li>Preuzete datoteke (Excel, ZIP paket ZNS-a, evidencija rada za ispis) nisu provjerene kao pristupačni dokumenti.</li>
          <li>Sesija istječe nakon 8 sati; upisano ostaje na zaslonu i nastavlja se nakon ponovne prijave, ali se vrijeme ne može produžiti unaprijed.</li>
        </ul>
        <h2>Prijava prepreke</h2>
        <p>Ako nešto ne možeš napraviti zbog načina na koji je sučelje izvedeno, javi se <b>administratoru ArQus Projekata u svojoj instituciji</b>{contact ? <> ili na <b>{contact}</b></> : null}. Navedi zaslon, što si pokušavao/la napraviti i koju pomoćnu tehnologiju koristiš. Prijave prosljeđujemo razvoju proizvoda.</p>
        {contact === null && <p className="muted small-note">Ova instalacija nije navela poseban kontakt za pristupačnost (postavka <code>ACCESSIBILITY_CONTACT</code>).</p>}
        <h2>Izjava institucije</h2>
        <p className="muted">Institucija kao tijelo javnog sektora objavljuje vlastitu izjavu o pristupačnosti i odgovara za nju, uključujući postupak praćenja i nadzorno tijelo. Ova stranica i izvještaj o sukladnosti po kriterijima WCAG 2.1 (dokument <code>docs/PRISTUPACNOST.md</code> u isporuci proizvoda) služe joj kao podloga.</p>
      </div>
    </div>
  );
}
