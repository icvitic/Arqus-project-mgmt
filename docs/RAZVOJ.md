# Razvoj – lokalno pokretanje

## Preduvjeti
Node 22 (`.nvmrc`), pnpm 10 (`corepack enable`), Docker (za bazu, Redis, MinIO).

## Prvi put
```bash
pnpm install
```
```bash
pnpm infra:up
```
```bash
pnpm build
```

## Svakodnevno
```bash
pnpm dev
```
API: http://localhost:3000/api/health · Web: http://localhost:5173 (proxy `/api` → 3000).

```bash
pnpm typecheck && pnpm test
```

## Struktura
| Putanja | Sadržaj |
| --- | --- |
| `apps/api` | NestJS API; jedan modul po domenskom modulu (`src/health`, `src/programmes`, …) |
| `apps/web` | React/Vite sučelje |
| `packages/domain` | tipovi, validator paketa programa, izračun proračuna; CLI `node packages/domain/dist/cli.js <mapa>` |
| `docs/domena/paketi` | izvor istine za shemu i pakete programa (HE, NPOO) |
| `infra` | Docker Compose i `.env.example` |
| `prototip` | klikabilni prototip iz faze 0 (bez backenda) |

## Pravila
- Moduli API-ja ne čitaju tuđe tablice; komunikacija kroz servise i događaje (ADR-0002, domenski model odj. 1).
- Izračuni koji ovise o pravilima programa žive u `@arqus/domain`, ne u kontrolerima.
- Svaka promjena sheme paketa: ažurirati `docs/domena/paketi/schema.v1.json` i kopiju u `packages/domain/src/schema/` (test to provjerava).
