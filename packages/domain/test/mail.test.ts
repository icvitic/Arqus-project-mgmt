import { describe, it, expect } from 'vitest';
import {
  digestMail, digestSlot, digestSubject, escapeHtml, hourIn, invitationMail, isWorkingDay, oneLine, passwordChangedMail, passwordResetMail, selectDigest, testMail,
  DIGEST_MAX_ITEMS, type DigestSelection,
} from '../src/mail.js';
import type { WorkItem } from '../src/my-work.js';

const TOKEN = 'Xq3vY8bN1mK0pR7sT2uW5zA9cD4eF6gH-_iJlLoOqQs';
const LINK = `https://arqus.example.hr/#/pozivnica/${TOKEN}`;
const tokenOutsideLink = (s: string, link: string) => s.split(link).join('').includes(TOKEN);
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const CTRL = new RegExp(`[\\r\\n\\x00${LS}${PS}]`);

describe('predlošci e-pošte (WP1.21)', () => {
  it('pozivnica: institucija, ime, poveznica, rok, što ako nije očekivana; token samo u poveznici', () => {
    const m = invitationMail({ institution: 'Institut Ruđer', recipientName: 'Ana Horvat', link: LINK, validHours: 168 });
    expect(m.subject).toBe('Pozivnica u ArQus Projekti – Institut Ruđer');
    expect(m.text).toContain('Pozdrav, Ana Horvat!');
    expect(m.text).toContain(LINK);
    expect(m.text).toContain('7 dana');
    expect(m.text).toContain('Ako nisi očekivao/la ovu poruku');
    expect(m.html).toContain(`href="${LINK}"`);
    expect(tokenOutsideLink(m.text, LINK)).toBe(false);
    expect(tokenOutsideLink(m.html, LINK)).toBe(false);
    expect(m.text.split(LINK).length - 1).toBe(1);
    expect(m.html).not.toMatch(/<img/i);
  });

  it('nova lozinka: rok u minutama, MFA ostaje, korisnik ili administrator', () => {
    const link = `https://arqus.example.hr/#/lozinka/${TOKEN}`;
    const self = passwordResetMail({ institution: 'FER', recipientName: 'Ivo', link, validMinutes: 60, byAdministrator: false });
    expect(self.text).toContain('1 h');
    expect(self.text).toContain('dvofaktorska prijava');
    expect(self.text).toContain('Ako nisi zatražio/la novu lozinku');
    expect(self.text).toContain('Zatražena je nova lozinka');
    expect(tokenOutsideLink(self.text, link)).toBe(false);
    expect(tokenOutsideLink(self.html, link)).toBe(false);
    const admin = passwordResetMail({ institution: 'FER', recipientName: 'Ivo', link, validMinutes: 90, byAdministrator: true });
    expect(admin.text).toContain('Administrator institucije FER');
    expect(admin.text).toContain('90 min');
  });

  it('naslov je uvijek jedan redak bez kontrolnih znakova (zlonamjeran naziv institucije)', () => {
    const evil = 'Inst\r\nBcc: napadac@example.com\r\n\r\nTijelo\u0000' + LS + 'x';
    for (const m of [
      invitationMail({ institution: evil, recipientName: 'A\r\nB', link: LINK, validHours: 24 }),
      passwordResetMail({ institution: evil, recipientName: 'A', link: LINK, validMinutes: 60, byAdministrator: false }),
      passwordChangedMail({ institution: evil, recipientName: 'A', when: new Date(), timeZone: 'Europe/Zagreb', loginUrl: 'https://a.hr/' }),
      testMail({ institution: evil, recipientName: 'A', when: new Date(), timeZone: 'Europe/Zagreb' }),
    ]) {
      expect(m.subject).not.toMatch(CTRL);
      expect(m.subject.length).toBeLessThanOrEqual(200);
    }
    expect(oneLine('a\r\n\tb   c')).toBe('a b c');
    expect(oneLine('x'.repeat(300), 10)).toHaveLength(10);
  });

  it('HTML escape (ime i institucija ne mogu ubaciti oznake)', () => {
    const m = invitationMail({ institution: '<script>alert(1)</script>', recipientName: '"Ana" & <b>', link: LINK, validHours: 168 });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('&quot;Ana&quot; &amp; &lt;b&gt;');
    expect(escapeHtml(`'`)).toBe('&#39;');
  });

  it('obavijest o promjeni lozinke: vrijeme u zoni institucije', () => {
    const m = passwordChangedMail({ institution: 'FER', recipientName: 'Ivo', when: new Date('2026-11-18T13:05:00Z'), timeZone: 'Europe/Zagreb', loginUrl: 'https://arqus.example.hr/' });
    expect(m.text).toContain('18. 11. 2026. u 14:05');
    expect(m.text).toContain('odmah se javi administratoru');
  });
});

const item = (o: Partial<WorkItem>): WorkItem => ({ key: Math.random().toString(), kind: 'deliverable_due', role: 'manager', urgency: 'waiting', due: null, days: null, title: 'Stavka', link: 'projekti/p1/struktura', ...o });

describe('dnevni sažetak – odabir (WP1.21)', () => {
  const since = new Date('2026-11-17T06:00:00Z');
  it('bez kasni/uskoro i bez novih obavijesti → ništa', () => {
    expect(selectDigest([item({ urgency: 'waiting' }), item({ urgency: 'info' })], [], since)).toBeNull();
    // pročitana ili starija od prethodnog sažetka ne broji se
    expect(selectDigest([], [{ title: 'x', createdAt: '2026-11-17T08:00:00Z', read: true }, { title: 'y', createdAt: '2026-11-16T08:00:00Z', read: false }], since)).toBeNull();
  });
  it('kasni i uskoro po roku, čeka samo kao broj, nove obavijesti nakon prethodnog sažetka', () => {
    const s = selectDigest([
      item({ urgency: 'due_soon', days: 10, title: 'B' }), item({ urgency: 'overdue', days: -1, title: 'O1' }), item({ urgency: 'overdue', days: -9, title: 'O2' }),
      item({ urgency: 'due_soon', days: 2, title: 'A' }), item({ urgency: 'waiting' }), item({ urgency: 'waiting' }),
    ], [{ title: 'nova', createdAt: '2026-11-17T09:00:00Z', read: false }], since)!;
    expect(s.overdue.map((x) => x.title)).toEqual(['O2', 'O1']);
    expect(s.dueSoon.map((x) => x.title)).toEqual(['A', 'B']);
    expect(s.waiting).toBe(2);
    expect(s.notifications).toEqual([{ title: 'nova' }]);
    expect(digestSubject(s)).toBe('ArQus: 2 kasni, 2 uskoro, 1 nova obavijest');
  });
  it('samo nova obavijest je dovoljna; bez prethodnog sažetka broje se sve nepročitane', () => {
    const s = selectDigest([], [{ title: 'a', createdAt: '2020-01-01T00:00:00Z', read: false }, { title: 'b', createdAt: '2020-01-02T00:00:00Z', read: false }], null)!;
    expect(digestSubject(s)).toBe('ArQus: 2 nove obavijesti');
    expect(digestSubject({ overdue: [], dueSoon: [], waiting: 0, notifications: Array(5).fill({ title: 'x' }) })).toBe('ArQus: 5 novih obavijesti');
  });
  it('sadržaj: najviše 15 stavki uz „i još N”, poveznica na Moj rad, bez iznosa i bez tokena', () => {
    const many = Array.from({ length: 20 }, (_, n) => item({ urgency: 'overdue', days: -n, title: `Isporuka D${n}`, acronym: 'BLUE', due: '2026-11-01' }));
    const sel: DigestSelection = selectDigest(many, [{ title: 'Timesheet za listopad 2026. je odobren (BLUE)', createdAt: new Date(), read: false }], null)!;
    const m = digestMail({ institution: 'FER', recipientName: 'Ana', selection: sel, appUrl: 'https://arqus.example.hr/', today: '2026-11-18' });
    expect(m.text.match(/^- \[BLUE\]/gm)).toHaveLength(DIGEST_MAX_ITEMS);
    expect(m.text).toContain('… i još 5 u „Moj rad”.');
    expect(m.text).toContain('https://arqus.example.hr/#/moj-rad');
    expect(m.text).toContain('Moj račun → Dnevni sažetak e-poštom');
    expect(m.text).toContain('rok 1. 11. 2026.');
    expect(m.text).not.toMatch(/€|EUR|\d+,\d{2}/);
    expect(m.subject).toBe('ArQus: 20 kasni, 1 nova obavijest');
  });
});

describe('radni dan i vrijeme sažetka u zoni institucije (WP1.21)', () => {
  it('ponedjeljak–petak su radni dani, vikend nije', () => {
    expect(isWorkingDay('2026-11-16')).toBe(true); // ponedjeljak
    expect(isWorkingDay('2026-11-20')).toBe(true); // petak
    expect(isWorkingDay('2026-11-21')).toBe(false); // subota
    expect(isWorkingDay('2026-11-22')).toBe(false); // nedjelja
  });
  it('7:00 po Zagrebu, a ne po UTC-u (zima UTC+1, ljeto UTC+2)', () => {
    expect(digestSlot(new Date('2026-11-18T05:59:00Z'), 'Europe/Zagreb')).toEqual({ day: '2026-11-18', due: false }); // 6:59
    expect(digestSlot(new Date('2026-11-18T06:00:00Z'), 'Europe/Zagreb')).toEqual({ day: '2026-11-18', due: true }); // 7:00
    expect(digestSlot(new Date('2027-06-16T05:00:00Z'), 'Europe/Zagreb').due).toBe(true); // 7:00 ljetno
    expect(digestSlot(new Date('2027-06-16T04:59:00Z'), 'Europe/Zagreb').due).toBe(false);
    expect(digestSlot(new Date('2026-11-18T11:00:00Z'), 'Europe/Zagreb').due).toBe(false); // 12:00 – prozor je prošao
    expect(hourIn('Europe/Zagreb', new Date('2026-11-18T23:30:00Z'))).toBe(0);
  });
  it('dan institucije oko ponoći: petak 23:30 UTC je subota u Zagrebu (nije radni dan)', () => {
    // nedjelja 23:30 UTC = ponedjeljak 0:30 u Zagrebu → radni dan, ali prije 7:00
    expect(digestSlot(new Date('2026-11-22T23:30:00Z'), 'Europe/Zagreb')).toEqual({ day: '2026-11-23', due: false });
    expect(digestSlot(new Date('2026-11-21T06:30:00Z'), 'Europe/Zagreb')).toEqual({ day: '2026-11-21', due: false });
    // Tokyo: ponedjeljak 7:30 lokalno je nedjelja 22:30 UTC
    expect(digestSlot(new Date('2026-11-22T22:30:00Z'), 'Asia/Tokyo')).toEqual({ day: '2026-11-23', due: true });
  });
});
