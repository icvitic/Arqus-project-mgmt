/**
 * WP1.17 – granice čitanja datoteke za uvoz. Datoteka je neprijateljski ulaz: svaka granica sprječava da mala datoteka
 * potroši memoriju ili procesor poslužitelja (ZIP bomba, golemi XML, milijuni redaka). Prekoračenje je jasna greška
 * korisniku, nikad tiho skraćivanje.
 */
export const IMPORT_LIMITS = {
  /** Najveća datoteka koja se prima (prijenos se prekida iznad toga). */
  maxFileBytes: 5 * 1024 * 1024,
  /** Najviše zapisa u ZIP-u (radna knjiga ima desetak). */
  maxEntries: 1000,
  /** Najveća raspakirana veličina jednog zapisa (npr. lista) i svih zajedno. */
  maxEntryBytes: 25 * 1024 * 1024,
  maxTotalBytes: 60 * 1024 * 1024,
  /** Najviše listova u radnoj knjizi. */
  maxSheets: 200,
  /** Najviše redaka s podacima po listu i najveći broj retka. */
  maxRows: 10_000,
  maxRowNumber: 1_048_576,
  /** Stupci iza ovoga se zanemaruju (uz upozorenje). */
  maxColumns: 100,
  /** Najdulji tekst u ćeliji (granica Excela). */
  maxCellChars: 32_767,
  /** Najviše dijeljenih nizova. */
  maxSharedStrings: 1_000_000,
  /** Najveća dubina ugniježđenih XML elemenata. */
  maxXmlDepth: 64,
} as const;

/** Greška čitanja datoteke – poruka je za korisnika (što čitač nije razumio i kako to popraviti). */
export class ImportFileError extends Error {
  constructor(message: string, readonly code: string = 'import_file_invalid') { super(message); }
}
