import { Global, Module } from '@nestjs/common';
import { MAIL_SETTINGS, MAIL_TRANSPORT, mailSettingsFromEnv, type MailSettings, type MailTransport } from './mail-config';
import { MailService } from './mail.service';
import { smtpSend } from './smtp-client';

/**
 * WP1.21 – e-pošta. Postavke se čitaju i provjeravaju pri pokretanju (neispravne → aplikacija se ne pokreće); prijenos je
 * vlastiti SMTP klijent (`smtp-client.ts`). Testovi zamjenjuju `MAIL_SETTINGS` i `MAIL_TRANSPORT` (hvatanje poruka).
 */
@Global()
@Module({
  providers: [
    { provide: MAIL_SETTINGS, useFactory: (): MailSettings => mailSettingsFromEnv() },
    {
      provide: MAIL_TRANSPORT, inject: [MAIL_SETTINGS],
      useFactory: (s: MailSettings): MailTransport => ({
        send: (m) => (s.smtp ? smtpSend(s.smtp, m) : Promise.reject(new Error('E-pošta nije uključena'))),
      }),
    },
    MailService,
  ],
  exports: [MailService, MAIL_SETTINGS],
})
export class MailModule {}
