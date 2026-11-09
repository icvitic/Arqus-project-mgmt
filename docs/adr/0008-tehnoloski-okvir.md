# ADR-0008: Tehnološki okvir faze 1

- **Status:** prihvaćeno · **Datum:** 2026-11-09 · dopunjuje ADR-0002

## Kontekst
ADR-0002 ostavio je izbor okvira za WP1.1. Kriteriji: mali tim, TypeScript kroz cijeli stog, modularni monolit s jasnim granicama, lako testiranje, široko poznat ekosustav radi zapošljavanja.

## Odluka
| Sloj | Izbor | Razlog |
| --- | --- | --- |
| Monorepo | pnpm workspaces (`apps/*`, `packages/*`), Node 22 | jednostavno, bez dodatnog alata za orkestraciju; `pnpm -r` dovoljan za sada |
| Backend | **NestJS 11** (Express), CommonJS | moduli i DI prirodno preslikavaju domenske module (M1–M11); poznat HR developerima |
| Domena | `@arqus/domain` – čisti TypeScript (ESM) bez ovisnosti o okviru: tipovi, validacija paketa (Ajv 2020-12), izračuni proračuna | ista pravila u API-ju, web sučelju i CLI-ju; testira se bez baze |
| Frontend | **React 19 + Vite 6** | standard; prototip iz WP0.5 prenosi se u komponente |
| Baza | PostgreSQL 16 (RLS po stanaru), ORM odabir u WP1.2 (Prisma ili Drizzle – Drizzle preferiran zbog RLS i SQL-u bliskog modela) | ADR-0002 |
| Pohrana / red | MinIO (S3) lokalno, Redis | ADR-0002 |
| Testovi | Vitest svugdje (API preko `unplugin-swc` zbog dekoratora), supertest za e2e | jedan test-runner za cijeli repozitorij |
| CI | GitHub Actions: typecheck → test → build → validacija paketa programa | svaki PR |
| Lokalno okruženje | Docker Compose (`infra/docker-compose.yml`) | isto za sve developere |

Izostavljeno namjerno (za sada): ESLint/Prettier (dodati u WP1.2 uz prvi veći kod), Kubernetes/Terraform (WP1.9, pilot), Turborepo/Nx (dok `pnpm -r` nije spor).

## Posljedice
- `@arqus/domain` je ESM, API je CJS; Node ≥ 22.12 učitava ESM iz CJS (`require(esm)`), paket izvozi `default` uvjet. Ako se pokaže krhko, domena se gradi dvostruko (CJS + ESM).
- Shema paketa programa ima izvor u `docs/domena/paketi/schema.v1.json`; kopija u paketu provjerava se testom da ne divergira.
