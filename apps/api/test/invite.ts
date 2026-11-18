import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * WP1.21 – jedini način na koji testovi stvaraju korisnike s lozinkom: kroz stvarni tok pozivnice (kao administrator bez
 * uključene e-pošte – API tada vraća token jednom), pa prihvaćanje pozivnice s lozinkom koju bira korisnik. Nema testnog
 * prečaca u API-ju koji bi postavljao tuđu lozinku.
 */
export interface InvitedUser { id: string; accessToken: string; body: Record<string, unknown> }

export async function inviteUser(app: INestApplication, adminToken: string, user: { email: string; displayName: string; roleCodes?: string[] }, password: string): Promise<InvitedUser> {
  const http = request(app.getHttpServer());
  const created = await http.post('/api/users').set({ Authorization: `Bearer ${adminToken}` }).send(user);
  if (created.status !== 201) throw new Error(`Pozivnica nije stvorena (${created.status}): ${JSON.stringify(created.body)}`);
  const token = (created.body as { invitation?: { token?: string } }).invitation?.token;
  if (!token) throw new Error('API nije vratio token pozivnice (je li uključena e-pošta?)');
  const accepted = await request(app.getHttpServer()).post('/api/auth/invitation/accept').send({ token, password });
  if (accepted.status !== 201) throw new Error(`Pozivnica nije prihvaćena (${accepted.status}): ${JSON.stringify(accepted.body)}`);
  return { id: (created.body as { id: string }).id, accessToken: (accepted.body as { accessToken: string }).accessToken, body: created.body as Record<string, unknown> };
}
