import { Controller, Get } from '@nestjs/common';
import { Public } from '../identity/auth.guard';

/**
 * WP1.22 – javni podaci za stranicu „Pristupačnost” (dostupna bez prijave): kontakt za prijavu prepreka koji postavlja
 * instalacija (`ACCESSIBILITY_CONTACT`). Ne otkriva ništa drugo o instalaciji; bez kontakta vraća null.
 */
export function accessibilityContact(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env.ACCESSIBILITY_CONTACT ?? '').trim();
  return v ? v.slice(0, 300) : null;
}

@Public()
@Controller('public')
export class PublicInfoController {
  @Get('accessibility')
  accessibility(): { contact: string | null } { return { contact: accessibilityContact() }; }
}
