import { ForbiddenException } from '@nestjs/common';
import { canOnProject } from './access';
import { currentContext } from './tenant-context';

/**
 * WP1.19 – iznosi pripisivi radu jedne osobe (trošak osoblja nastao odobrenjem timesheeta: iznos i priznati iznos po
 * retku, zbroj po osobi i mjesecu, trošak osoblja u odgovoru na odobrenje) vraćaju se samo korisniku s `personnel:read`
 * na tom projektu. Ostali dobivaju sate i oznaku `amountHidden: true`, a iznos je `null` – nikad broj iz kojeg se može
 * izračunati satnica. Zbrojevi po kategoriji i projektu ostaju vidljivi (upravljanje proračunom); kategorija s jednom
 * osobom je preostalo, svjesno prihvaćeno otkrivanje (`docs/sigurnost/AUTORIZACIJA.md`).
 */
export const PERSONNEL_AMOUNT_HIDDEN = 'Iznos troška osoblja vidljiv je samo uz pristup podacima o osoblju (personnel:read)';

/** Smije li korisnik iz konteksta vidjeti iznose troškova osoblja na projektu (bez konteksta – sistemski posao – da). */
export const seesPersonnelAmounts = (projectId: string): boolean => {
  const c = currentContext();
  return !c?.userId || canOnProject(c, 'personnel:read', projectId);
};

/**
 * Izvori troška koji su iznos rada jedne osobe: trošak iz odobrenog timesheeta i (WP1.17) trošak osoblja iz ranijeg
 * razdoblja uvezen iz Excela (iznos po osobi i mjesecu, potraživan izvan sustava) – isto skrivanje.
 */
export const PERSONNEL_SOURCES: readonly string[] = ['timesheet', 'historic_personnel'];
export const isPersonnelSource = (source: string): boolean => PERSONNEL_SOURCES.includes(source);
/** Je li iznos ovog troška skriven za korisnika (samo trošak osoblja). */
export const hidesAmount = (source: string, canSee: boolean): boolean => isPersonnelSource(source) && !canSee;

/**
 * Odluka o ZNS-u: bez `personnel:read` korisnik s `finance:write` donosi odluku, vraća zahtjev i bilježi isplatu, ali o
 * pojedinom trošku osoblja ne odlučuje (umanjenje ili odbijanje bi kroz razliku zbrojeva otkrilo njegov iznos) – takav
 * trošak ostaje priznat kako je zatražen (ili kako je ranije odlučeno) dok o njemu ne odluči uloga s tom dozvolom.
 */
export function assertMayDecidePersonnel(projectId: string, personnelIds: ReadonlySet<string>, decided: readonly { id: string }[] | undefined): void {
  if (seesPersonnelAmounts(projectId)) return;
  if ((decided ?? []).some((d) => personnelIds.has(d.id))) {
    throw new ForbiddenException('O pojedinom trošku osoblja odlučuje uloga s pristupom podacima o osoblju (personnel:read, npr. financije ili ured za projekte). Bez nje trošak osoblja ostaje priznat kako je zatražen; ostale troškove i odluku o zahtjevu možeš unijeti.');
  }
}
