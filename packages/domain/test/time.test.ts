import { describe, it, expect } from 'vitest';
import { DEFAULT_TIME_ZONE, dateIn, isValidTimeZone, timeZoneOr, todayIn } from '../src/time.js';
import { callStatus, daysUntil } from '../src/call.js';

describe('„danas” u zoni institucije (WP1.14b)', () => {
  it('zadana zona je Europe/Zagreb', () => expect(DEFAULT_TIME_ZONE).toBe('Europe/Zagreb'));
  it('oko ponoći po zagrebačkom vremenu (ljetno računanje, UTC+2)', () => {
    expect(todayIn('Europe/Zagreb', new Date('2027-03-31T21:59:00Z'))).toBe('2027-03-31'); // 23:59 u Zagrebu
    expect(todayIn('Europe/Zagreb', new Date('2027-03-31T22:00:00Z'))).toBe('2027-04-01'); // 00:00 u Zagrebu, u UTC-u još 31. 3.
    expect(new Date('2027-03-31T22:00:00Z').toISOString().slice(0, 10)).toBe('2027-03-31');
  });
  it('zimsko računanje (UTC+1) i prijelaz godine', () => {
    expect(todayIn('Europe/Zagreb', new Date('2026-12-31T22:59:00Z'))).toBe('2026-12-31');
    expect(todayIn('Europe/Zagreb', new Date('2026-12-31T23:00:00Z'))).toBe('2027-01-01');
  });
  it('druge zone i neispravna postavka', () => {
    expect(todayIn('UTC', new Date('2027-03-31T22:00:00Z'))).toBe('2027-03-31');
    expect(dateIn('America/New_York', '2027-04-01T02:00:00Z')).toBe('2027-03-31');
    expect(isValidTimeZone('Europe/Zagreb')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
    expect(timeZoneOr('Mars/Olympus')).toBe('Europe/Zagreb');
    expect(todayIn('Mars/Olympus', new Date('2027-03-31T22:00:00Z'))).toBe('2027-04-01');
  });
  it('broj dana do roka i otvaranje poziva po lokalnom danu', () => {
    const justAfterMidnight = new Date('2027-03-31T22:30:00Z'); // 1. 4. 00:30 u Zagrebu
    expect(daysUntil('2027-04-01T15:00:00Z', justAfterMidnight)).toBe(0);
    expect(daysUntil('2027-04-01T15:00:00Z', justAfterMidnight, 'UTC')).toBe(1);
    expect(callStatus({ opensAt: '2027-04-01', deadlines: [] }, justAfterMidnight)).toBe('open');
    expect(callStatus({ opensAt: '2027-04-01', deadlines: [] }, new Date('2027-03-31T21:30:00Z'))).toBe('announced');
  });
});
