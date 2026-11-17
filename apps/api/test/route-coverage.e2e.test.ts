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
import { routeAccess, type RouteAccess } from '../src/identity/auth.guard';
import { buildAccessFixture, PDF, type AccessFixture } from './access-fixture';

/**
 * WP1.14 – pokrivenost ruta. Popisuje SVE rute registrirane u Nest aplikaciji i pada ako ijedna nije izričito razvrstana
 * (javna / samo prijava / institucija / projekt / projekt razriješen iz entiteta / bilo koji opseg). Za svaku rutu s projektom
 * automatski provjerava da korisnik s dodjelom samo na projektu A za id-jeve projekta B dobiva 404 (nikad 2xx);
 * za svaku rutu institucije da ga ista uloga na projektu ne pušta (403). Nova ruta tako ne može tiho preskočiti autorizaciju.
 */
interface Route { method: string; path: string; access: RouteAccess | { kind: 'invalid'; reason: string } }

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
          routes.push({ method: RequestMethod[method]!, path: join2('api', b, s), access: routeAccess(reflector, [handler as never, ctrl]) });
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
    f = await buildAccessFixture(app, `rc-${tag}`);
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
    // Rute s projektnim entitetom izvan /projects (dokumenti) razrješavaju projekt u servisu.
    expect(routes.filter((r) => r.path.startsWith('/api/documents')).every((r) => r.access.kind === 'resolves-project')).toBe(true);
    // Javne rute: samo health i prijava.
    expect(routes.filter((r) => r.access.kind === 'public').map((r) => `${r.method} ${r.path}`).sort()).toEqual(['GET /api/health', 'GET /api/health/ready', 'POST /api/auth/login']);
  });

  /** Id-jevi projekta B za parametre putanje; nepoznati parametar ruši test (treba ga dodati ovdje). */
  const paramsB = (): Record<string, string> => ({
    id: f.B.id, wpId: f.B.wp, taskId: f.B.task, did: f.B.deliverable, mid: f.B.member, rid: f.B.risk, eid: f.B.expense, cid: f.B.claim,
    partnerId: f.B.self, assignmentId: randomUUID(), month: f.month, n: '1',
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
    expect(any).toEqual(['GET /api/organisations', 'GET /api/organisations/:id', 'GET /api/programme-packages', 'GET /api/programme-packages/:packageId', 'GET /api/programme-packages/rows/:rowId', 'GET /api/projects'].sort());
    const list = (await http().get('/api/projects').set({ Authorization: `Bearer ${f.tokens.pm}` }).expect(200)).body as { id: string }[];
    expect(list.map((p) => p.id)).toEqual([f.A.id]);
  });
});
