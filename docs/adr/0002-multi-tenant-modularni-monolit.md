# ADR-0002: Multi-tenant modularni monolit

- **Status:** prihvaćeno · **Datum:** 2026-11-08

## Kontekst
Mali tim, potreba za brzom isporukom, ponuda kao SaaS (dijeljena infrastruktura) i PaaS (zasebna instanca, white-label).

## Odluka
- Jedna baza koda, modularni monolit: moduli s jasnim granicama (vlastite sheme i javna sučelja), API-first (OpenAPI).
- Stanari (tenants) u zajedničkoj PostgreSQL bazi s Row-Level Security za standardne pakete; zasebna baza ili instanca za Enterprise/PaaS („bridge” model).
- Okvirne tehnologije: TypeScript (Node.js) backend, React frontend, PostgreSQL, S3-kompatibilna pohrana, red poruka (Redis). Konačan izbor okvira potvrđuje se u WP1.1.
- Mikroservisi samo kad mjerenja pokažu potrebu.

## Posljedice
Brži razvoj i niži trošak po kupcu; izolacija stanara mora se testirati automatski od prvog dana (testovi koji dokazuju da stanar A ne vidi podatke stanara B).
