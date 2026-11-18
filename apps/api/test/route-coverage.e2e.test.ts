import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { MFA_SETUP_ALLOWED_KEY, routeAccess, type RouteAccess } from '../src/identity/auth.guard';
import { buildAccessFixture, PDF, type AccessFixture } from './access-fixture';

/**
 * WP1.14 – pokrivenost ruta. Popisuje SVE rute registrirane u Nest aplikaciji i pada ako ijedna nije izričito razvrstana
 * (javna / samo prijava / institucija / projekt / projekt razriješen iz entiteta / bilo koji opseg). Za svaku rutu s projektom
 * automatski provjerava da korisnik s dodjelom samo na projektu A za id-jeve projekta B dobiva 404 (nikad 2xx);
 * za svaku rutu institucije da ga ista uloga na projektu ne pušta (403). Nova ruta tako ne može tiho preskočiti autorizaciju.
 */
interface Route { method: string; path: string; access: RouteAccess | { kind: 'invalid'; reason: string }; mfaSetup: boolean }

const join2 = (...parts: (string | undefined)[]) => '/' + parts.flatMap((p) => (p ?? '').split('/')).filter(Boolean).join('/');

function enumerateRoutes(app: INestApplication): Route[] {
  const reflector = app.get(Reflector);
  const routes: Route[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as (new (...a: never[]) => object) | null;
      if (!ctrl) continue;
      const base = Reflect.getMetadata(PATH_METADATA, ctrl) as string | string[] | undefined;
      const proto = ctrl.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        for (const b of [base].flat()) for (const s of [sub].flat()) {
          routes.push({ method: RequestMethod[method]!, path: join2('api', b, s), access: routeAccess(reflector, [handler as never, ctrl]), mfaSetup: !!reflector.getAllAndOverride<boolean>(MFA_SETUP_ALLOWED_KEY, [handler as never, ctrl]) });
        }
      }
    }
  }
  return routes;
}

describe('Pokrivenost ruta autorizacijom (WP1.14, e2e)', () => {
  let app: INestApplication; let f: AccessFixture; let routes: Route[] = [];
  const tag = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://arqus_app:arqus@127.0.0.1:5433/arqus_test';
    process.env.DOCUMENTS_DIR = mkdtempSync(join(tmpdir(), 'arqus-routes-'));
    const m = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = m.createNestApplication(); app.setGlobalPrefix('api'); await app.init();
    routes = enumerateRoutes(app);
    f = await buildAccessFixture(app, `rc-${tag}`, { proposals: true });
  }, 60_000);
  afterAll(async () => { await app.close(); });

  it('popis ruta odgovara rutama registriranim u Expressu (ništa nije propušteno)', () => {
    const router = (app.getHttpAdapter().getInstance() as { router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] } }).router;
    const registered = router.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route!.methods).filter((m) => m !== '_all').map((m) => `${m.toUpperCase()} ${l.route!.path}`));
    const ours = routes.map((r) => `${r.method} ${r.path}`);
    expect(new Set(registered)).toEqual(new Set(ours));
    expect(routes.length).toBeGreaterThan(80);
  });

  it('svaka ruta je izričito razvrstana (jedna oznaka)', () => {
    const invalid = routes.filter((r) => r.access.kind === 'invalid').map((r) => `${r.method} ${r.path}: ${(r.access as { reason: string }).reason}`);
    expect(invalid).toEqual([]);
    // Ruta s :id pod /projects mora biti projektna (ili institucijska) – nikad "samo prijava" ili javna.
    const weak = routes.filter((r) => r.path.startsWith('/api/projects/:id') && !['project'].includes(r.access.kind)).map((r) => `${r.method} ${r.path} (${r.access.kind})`);
    expect(weak).toEqual([]);
    // WP1.14b: rute prijave s :id su „prijava” (institucija ili voditelj te prijave) ili radnja institucije – nikad slabije.
    const weakProposal = routes.filter((r) => r.path.startsWith('/api/proposals/:id') && !['proposal', 'tenant'].includes(r.access.kind)).map((r) => `${r.method} ${r.path} (${r.access.kind})`);
    expect(weakProposal).toEqual([]);
    // Radnje institucije na prijavi: predaja, ishod, ugovaranje; nova prijava.
    expect(routes.filter((r) => r.path.startsWith('/api/proposals') && r.access.kind === 'tenant').map((r) => `${r.method} ${r.path}`).sort())
      .toEqual(['POST /api/proposals', 'POST /api/proposals/:id/contract', 'POST /api/proposals/:id/outcome', 'POST /api/proposals/:id/submit'].sort());
    // Rute s projektnim entitetom izvan /projects (dokumenti) razrješavaju projekt u servisu.
    expect(routes.filter((r) => r.path.startsWith('/api/documents')).every((r) => r.access.kind === 'resolves-project')).toBe(true);
    // Javne rute: health, prijava, (WP1.18) osobni kalendar rokova po tajnom tokenu i (WP1.21) zaboravljena lozinka, pregled
    // poveznice, prihvaćanje pozivnice i nova lozinka, (WP1.22) kontakt za stranicu „Pristupačnost” – izričit popis, nova javna
    // ruta ruši test.
    expect(routes.filter((r) => r.access.kind === 'public').map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'GET /api/calendar/:token', 'GET /api/health', 'GET /api/health/ready', 'GET /api/public/accessibility', 'POST /api/auth/invitation/accept', 'POST /api/auth/login',
      'POST /api/auth/password/forgot', 'POST /api/auth/password/reset', 'POST /api/auth/token/inspect',
    ]);
    // WP1.21: token računa nikad u putanji ili upitu (zapisi pristupa, Referer) – javne rute računa nemaju parametar putanje.
    expect(routes.filter((r) => r.access.kind === 'public' && r.path.startsWith('/api/auth') && r.path.includes(':'))).toEqual([]);
    // WP1.21: upravljanje pozivnicama i poveznicama za novu lozinku traži istu dozvolu kao upravljanje korisnicima; nijedna
    // ruta više ne postavlja tuđu lozinku.
    expect(routes.filter((r) => r.path.startsWith('/api/users')).map((r) => `${r.method} ${r.path} ${(r.access as { permission?: string }).permission}`).sort()).toEqual([
      'DELETE /api/users/:id/invitation users:write', 'GET /api/users users:read', 'PATCH /api/users/:id users:write', 'POST /api/users users:write',
      'POST /api/users/:id/invitation users:write', 'POST /api/users/:id/password-link users:write', 'POST /api/users/:id/reset-mfa users:write',
    ]);
    expect(routes.filter((r) => /password/.test(r.path)).map((r) => `${r.method} ${r.path} (${r.access.kind})`).sort()).toEqual([
      'POST /api/auth/password/forgot (public)', 'POST /api/auth/password/reset (public)', 'POST /api/me/password (authenticated)', 'POST /api/users/:id/password-link (tenant)',
    ]);
    // WP1.21: postavka dnevnog sažetka – korisnik o sebi (bez id-ja drugog korisnika), nije dostupna u ograničenom stanju MFA.
    expect(routes.filter((r) => r.path === '/api/me/digest').map((r) => `${r.method} ${r.access.kind} ${r.mfaSetup}`).sort()).toEqual(['GET authenticated false', 'PUT authenticated false']);
    expect(routes.filter((r) => r.path.startsWith('/api/tenant/mail')).map((r) => `${r.method} ${r.path} ${(r.access as { permission?: string }).permission}`).sort()).toEqual(['GET /api/tenant/mail users:read', 'POST /api/tenant/mail/test users:write']);
    // WP1.18: rute „o meni” traže samo prijavu (korisnik o sebi) i nisu dostupne u ograničenom stanju MFA (provjera ispod).
    expect(routes.filter((r) => r.path.startsWith('/api/me/') && ['work', 'notifications', 'calendar'].some((x) => r.path.startsWith(`/api/me/${x}`))).map((r) => `${r.method} ${r.path} (${r.access.kind})`).sort()).toEqual([
      'DELETE /api/me/calendar (authenticated)', 'GET /api/me/calendar (authenticated)', 'GET /api/me/notifications (authenticated)', 'GET /api/me/work (authenticated)',
      'POST /api/me/calendar (authenticated)', 'POST /api/me/notifications/:nid/read (authenticated)', 'POST /api/me/notifications/read-all (authenticated)',
    ]);
    // WP1.19: u ograničenom stanju (obvezni MFA nije postavljen) dostupne su samo ove rute – vlastiti račun i odjava.
    expect(routes.filter((r) => r.mfaSetup).map((r) => `${r.method} ${r.path} (${r.access.kind})`).sort()).toEqual([
      'GET /api/me (authenticated)', 'POST /api/auth/logout (authenticated)', 'POST /api/me/mfa/enable (authenticated)', 'POST /api/me/mfa/setup (authenticated)', 'POST /api/me/password (authenticated)',
    ].sort());
    // Rute projekta koje mijenjaju podatke uz oznaku samo `projects:read` – servis provjerava užu dozvolu: upravljanje
    // pristupom (WP1.14, users:write ili projects:write), uvoz iz Excela (WP1.17, dozvole po listu) i (WP1.22) „napredak”
    // vlastite stavke (voditelj ili odgovorna osoba u radnom dijelu životnog ciklusa – test/responsible.e2e.test.ts).
    // Nova takva ruta ruši test.
    expect(routes.filter((r) => r.access.kind === 'project' && r.method !== 'GET' && (r.access as { permission: string }).permission === 'projects:read').map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'DELETE /api/projects/:id/access/:assignmentId', 'POST /api/projects/:id/access', 'POST /api/projects/:id/deliverables/:did/progress',
      'POST /api/projects/:id/import/confirm', 'POST /api/projects/:id/import/preview', 'POST /api/projects/:id/imports/:importId/undo', 'POST /api/projects/:id/tasks/:taskId/progress',
    ]);
    // Sigurnosne postavke institucije (WP1.19): čitanje uz users:read, izmjena samo uz users:write (administrator).
    expect(routes.filter((r) => r.path === '/api/tenant/security').map((r) => `${r.method} ${(r.access as { permission?: string }).permission}`).sort()).toEqual(['GET users:read', 'PUT users:write']);
  });

  /** Id-jevi projekta B za parametre putanje; nepoznati parametar ruši test (treba ga dodati ovdje). */
  const paramsB = (): Record<string, string> => ({
    id: f.B.id, wpId: f.B.wp, taskId: f.B.task, did: f.B.deliverable, mid: f.B.member, rid: f.B.risk, eid: f.B.expense, cid: f.B.claim,
    partnerId: f.B.self, assignmentId: randomUUID(), month: f.month, n: '1', importId: randomUUID(), nid: '1',
  });
  const fill = (path: string, values: Record<string, string>) => path.replace(/:(\w+)/g, (_, k: string) => {
    if (!(k in values)) throw new Error(`Nepoznat parametar :${k} u ${path} – dodaj ga u paramsB`);
    return values[k]!;
  });
  const call = (method: string, url: string, token: string) => {
    const r = (http() as unknown as Record<string, (u: string) => request.Test>)[method.toLowerCase()]!(url).set({ Authorization: `Bearer ${token}` });
    return ['POST', 'PUT', 'PATCH'].includes(method) ? r.send({}) : r;
  };

  it('svaka ruta s projektom: korisnik s dodjelom samo na A za projekt B dobiva 404 (nikad 2xx)', async () => {
    const project = routes.filter((r) => r.access.kind === 'project');
    expect(project.length).toBeGreaterThan(35);
    const leaks: string[] = [];
    for (const r of project) {
      for (const token of [f.tokens.pm, f.tokens.tm]) {
        const res = await call(r.method, fill(r.path, paramsB()), token);
        if (res.status !== 404) leaks.push(`${r.method} ${r.path} → ${res.status}`);
      }
    }
    expect(leaks).toEqual([]);
  }, 60_000);

  it('svaka GET ruta s projektom radi za vlastiti projekt A (provjera da test ne prolazi zbog krivih id-jeva)', async () => {
    const valuesA = { ...paramsB(), id: f.A.id, wpId: f.A.wp, taskId: f.A.task, did: f.A.deliverable, mid: f.A.member, rid: f.A.risk, eid: f.A.expense, cid: f.A.claim, partnerId: f.A.self };
    const bad: string[] = [];
    for (const r of routes.filter((x) => x.access.kind === 'project' && x.method === 'GET')) {
      const res = await call('GET', fill(r.path, valuesA), f.tokens.pm);
      if (res.status !== 200) bad.push(`${r.path} → ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('svaka ruta dokumenata: dokument / entitet projekta B → 404', async () => {
    const leaks: string[] = [];
    for (const r of routes.filter((x) => x.access.kind === 'resolves-project')) {
      for (const token of [f.tokens.pm, f.tokens.tm]) {
        const url = fill(r.path, { ...paramsB(), id: f.B.doc });
        let req = (http() as unknown as Record<string, (u: string) => request.Test>)[r.method.toLowerCase()]!(r.path === '/api/documents' && r.method === 'GET' ? `${url}?projectId=${f.B.id}` : url).set({ Authorization: `Bearer ${token}` });
        // Prijenos traži datoteku prije provjere vlasnika – šaljemo valjanu, da odbijanje dođe od autorizacije.
        if (r.method === 'POST') req = r.path === '/api/documents' ? req.field('entityType', 'expense').field('entityId', f.B.expense).attach('file', PDF, 'x.pdf') : req.attach('file', Buffer.from('%PDF-1.7\nnovo\n%%EOF\n'), 'x.pdf');
        else if (r.method === 'PATCH') req = req.send({ title: 'x' });
        const res = await req;
        if (res.status !== 404) leaks.push(`${r.method} ${r.path} → ${res.status}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('svaka ruta prijave (WP1.14b): voditelj prijave X i korisnik bez prijava za tuđu prijavu dobivaju 404; voditelj vlastitu vidi', async () => {
    const proposal = routes.filter((r) => r.access.kind === 'proposal' && (r.access as { param: string | null }).param);
    expect(proposal.length).toBeGreaterThanOrEqual(11);
    const leaks: string[] = [];
    for (const r of proposal) {
      for (const token of [f.tokens.lead, f.tokens.pm, f.tokens.tm]) {
        const res = await call(r.method, fill(r.path, { id: f.proposals.other, mid: f.proposals.otherMember, wpId: randomUUID() }), token);
        if (res.status !== 404) leaks.push(`${r.method} ${r.path} → ${res.status}`);
      }
    }
    expect(leaks).toEqual([]);
    for (const r of proposal.filter((x) => x.method === 'GET')) {
      const res = await call('GET', fill(r.path, { id: f.proposals.mine }), f.tokens.lead);
      expect(res.status).toBe(200);
    }
    // Popis: voditelj vidi samo vlastitu prijavu; bez prijava i bez dozvole institucije 403.
    expect(((await http().get('/api/proposals').set({ Authorization: `Bearer ${f.tokens.lead}` }).expect(200)).body as { id: string }[]).map((p) => p.id)).toEqual([f.proposals.mine]);
    await http().get('/api/proposals').set({ Authorization: `Bearer ${f.tokens.pm}` }).expect(403);
    // Dokumenti tuđe prijave: 404 i za voditelja druge prijave.
    await http().get(`/api/documents?proposalId=${f.proposals.other}`).set({ Authorization: `Bearer ${f.tokens.lead}` }).expect(404);
    await http().get(`/api/documents?proposalId=${f.proposals.mine}`).set({ Authorization: `Bearer ${f.tokens.lead}` }).expect(200);
  });

  it('svaka ruta institucije: uloga samo na projektu ne dostaje (403)', async () => {
    const tenant = routes.filter((r) => r.access.kind === 'tenant');
    expect(tenant.length).toBeGreaterThan(30);
    const leaks: string[] = [];
    for (const r of tenant) {
      const res = await call(r.method, fill(r.path, { ...paramsB(), id: randomUUID(), callId: randomUUID(), rowId: randomUUID(), packageId: 'npoo-2021-2026' }), f.tokens.pm);
      if (res.status !== 403) leaks.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('rute „bilo koji opseg”: popisi ne otkrivaju projekte bez pristupa', async () => {
    const any = routes.filter((r) => r.access.kind === 'any-scope').map((r) => `${r.method} ${r.path}`).sort();
    expect(any).toEqual(['GET /api/organisations', 'GET /api/organisations/:id', 'GET /api/programme-packages', 'GET /api/programme-packages/:packageId', 'GET /api/programme-packages/rows/:rowId', 'GET /api/projects', 'GET /api/portfolio'].sort());
    const list = (await http().get('/api/projects').set({ Authorization: `Bearer ${f.tokens.pm}` }).expect(200)).body as { id: string }[];
    expect(list.map((p) => p.id)).toEqual([f.A.id]);
  });
});
