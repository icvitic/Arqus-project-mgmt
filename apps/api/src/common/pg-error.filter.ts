import { Catch, ConflictException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/** PostgreSQL greške ograničenja → 409 umjesto 500 (npr. brisanje partnera koji vodi radni paket, dvostruki broj). */
const MESSAGES: Record<string, string> = {
  '23505': 'Zapis s istim ključem već postoji',
  '23503': 'Zapis je povezan s drugim zapisima ili se poziva na nepostojeći zapis',
  '23514': 'Vrijednost ne zadovoljava pravilo baze',
};

function pgCode(e: unknown): string | undefined {
  const o = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = typeof o?.code === 'string' ? o.code : typeof o?.cause?.code === 'string' ? o.cause.code : undefined;
  return code && /^\d{5}$/.test(code) ? code : undefined;
}

@Catch()
export class PgErrorFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const code = pgCode(exception);
    const msg = code ? MESSAGES[code] : undefined;
    if (msg) {
      const detail = (exception as { constraint?: string; cause?: { constraint?: string } }).constraint ?? (exception as { cause?: { constraint?: string } }).cause?.constraint;
      return super.catch(new ConflictException({ message: msg, constraint: detail }), host);
    }
    return super.catch(exception, host);
  }
}
