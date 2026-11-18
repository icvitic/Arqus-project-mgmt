import { useEffect, useState } from 'react';

/**
 * WP1.23 – stranica „Privatnost” (dostupna i bez prijave, poveznica u podnožju; model: „Pristupačnost”). Što proizvod
 * obrađuje i zašto, tko je voditelj obrade (institucija), kako se ostvaruju prava i kontakt koji postavlja instalacija
 * (`PRIVACY_CONTACT`) – ne izmišlja se. Obavijest ispitanicima u smislu čl. 13 GDPR-a daje institucija; ova stranica joj
 * je podloga i ne zamjenjuje je.
 */
export function Privacy({ institution }: { institution?: string | null }) {
  const [contact, setContact] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch('/api/public/privacy', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null)).then((d: { contact?: string | null } | null) => { if (live) setContact(d?.contact ?? null); })
      .catch(() => { if (live) setContact(null); });
    return () => { live = false; };
  }, []);
  const who = institution ? <b>{institution}</b> : <b>tvoja institucija</b>;
  return (
    <div className="statement">
      <h1>Privatnost</h1>
      <p className="sub">Osobni podaci u proizvodu ArQus Projekti</p>
      <div className="card">
        <h2>Tko odgovara za tvoje podatke</h2>
        <p>{who} je <b>voditelj obrade</b>: ona odlučuje tko ima račun, koje projekte vodi i koliko dugo čuva podatke. Isporučitelj ArQus Projekata je <b>izvršitelj obrade</b> – obrađuje podatke samo po uputi institucije, na poslužiteljima u Europskoj uniji. Podaci jedne institucije odvojeni su od podataka drugih institucija i u bazi.</p>
        <h2>Što se obrađuje i zašto</h2>
        <ul>
          <li><b>Korisnički račun</b> – ime, e-adresa, uloge, vrijeme prijave; za prijavu i pristup. Lozinka se sprema samo kao nepovratni otisak, tajna dvofaktorske prijave šifrirana.</li>
          <li><b>Sesije</b> – IP adresa i preglednik prijave; za sigurnost i odjavu. Brišu se nakon nekoliko tjedana.</li>
          <li><b>Rad na projektima</b> – članstvo u timu, evidencija rada (sati po danu), odgovornosti; za vođenje projekta i dokaz rada prema financijeru.</li>
          <li><b>Trošak osoblja</b> – godišnji trošak (plaća) i iz njega izračunati trošak rada; za zahtjeve za nadoknadu. Vide ga samo uloge s pristupom podacima o plaćama (npr. financije).</li>
          <li><b>Dokumenti</b> – datoteke koje korisnici prenesu i tko ih je prenio.</li>
          <li><b>Revizijski zapis</b> – tko je što i kada promijenio; za dokaz i odgovornost. Ne mijenja se i ne briše prije isteka roka.</li>
          <li><b>Obavijesti i e-pošta</b> – obavijesti u aplikaciji i zapis o isporuci poruka (bez sadržaja).</li>
        </ul>
        <h2>Koliko dugo</h2>
        <p>Svaka vrsta podatka ima rok čuvanja koji postavlja institucija; nakon roka podaci se brišu automatski. Evidencija rada i troškovi čuvaju se dok traje obveza čuvanja dokumentacije projekta prema pravilima programa – nakon toga se ime osobe u njima može zamijeniti oznakom („Bivši član tima 1”), a iznosi i sati ostaju za financijsku evidenciju.</p>
        <h2>Tvoja prava</h2>
        <ul>
          <li><b>Pristup i prenosivost</b> – svoje podatke možeš sam preuzeti u <b>Moj račun → Moji podaci</b> (ZIP s datotekama JSON i Excel). Potpun izvoz, uključujući iznose plaće, izrađuje institucija na zahtjev.</li>
          <li><b>Ispravak</b> – ime i e-adresu ispravlja administrator; podatke o projektu voditelj projekta.</li>
          <li><b>Brisanje i ograničenje</b> – kad odeš iz institucije, račun se zatvara: prijava više nije moguća, a e-adresa, lozinka i sesije brišu se odmah. Ime ostaje na zapisima koje institucija mora čuvati kao financijski dokaz, do isteka roka čuvanja.</li>
          <li><b>Prigovor</b> – obrati se instituciji; pravo na pritužbu Agenciji za zaštitu osobnih podataka (AZOP) postoji neovisno o tome.</li>
        </ul>
        <h2>Kome se obratiti</h2>
        <p>Za sva pitanja o osobnim podacima obrati se <b>administratoru ArQus Projekata ili službeniku za zaštitu podataka u svojoj instituciji</b>{contact ? <> ili na <b>{contact}</b></> : null}.</p>
        {contact === null && <p className="muted small-note">Ova instalacija nije navela poseban kontakt za zaštitu podataka (postavka <code>PRIVACY_CONTACT</code>).</p>}
        <p className="muted">Ova stranica opisuje kako proizvod obrađuje podatke. Obavijest o obradi osobnih podataka i kontakt službenika za zaštitu podataka objavljuje institucija.</p>
      </div>
    </div>
  );
}
