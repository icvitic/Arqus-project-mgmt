/**
 * WP1.22 – odgovorna osoba na isporuci, prekretnici i zadatku. Odgovorna osoba je član tima istog projekta; određuje je
 * tko smije uređivati strukturu projekta (`projects:write`). Odgovorna osoba BEZ te dozvole smije svoju stavku pomaknuti
 * samo kroz RADNI dio životnog ciklusa – nikad naslov, rokove, dodjelu ni prihvaćanje/odbijanje koje pripada voditelju.
 * Isto pravilo provjerava poslužitelj (jedina provjera koja vrijedi) i sučelje (koje nudi samo dopuštene korake).
 */
export type ResponsibleItemKind = 'deliverable' | 'milestone' | 'task';

/**
 * Dopušteni prijelazi statusa za odgovornu osobu (od → na):
 * - isporuka: planirana → u izradi ili predana; u izradi → planirana (greška) ili predana; odbijena → u izradi ili predana
 *   (dorada nakon odbijanja). Prihvaćanje i odbijanje (i vraćanje predane) ostaje voditelju.
 * - zadatak: planiran → u tijeku ili gotov; u tijeku → planiran ili gotov. Otkazivanje i ponovno otvaranje gotovog: voditelj.
 * - prekretnica: nijedan – „postignuta” / „propuštena” je ocjena provjere (način provjere) koju daje voditelj; odgovorna
 *   osoba je vidi u „Moj rad” i dobiva obavijesti, a status ne mijenja.
 */
export const RESPONSIBLE_TRANSITIONS: Record<ResponsibleItemKind, Readonly<Record<string, readonly string[]>>> = {
  deliverable: { planned: ['in_progress', 'submitted'], in_progress: ['planned', 'submitted'], rejected: ['in_progress', 'submitted'] },
  task: { planned: ['in_progress', 'done'], in_progress: ['planned', 'done'] },
  milestone: {},
};

/** Smije li odgovorna osoba (bez prava uređivanja strukture) promijeniti status stavke `from` → `to`. */
export function responsibleMayChange(kind: ResponsibleItemKind, from: string, to: string): boolean {
  return from !== to && (RESPONSIBLE_TRANSITIONS[kind][from] ?? []).includes(to);
}

/** Koraci koje sučelje nudi odgovornoj osobi za stavku u statusu `from` (prazno = samo prikaz). */
export const responsibleNextStatuses = (kind: ResponsibleItemKind, from: string): readonly string[] => RESPONSIBLE_TRANSITIONS[kind][from] ?? [];
