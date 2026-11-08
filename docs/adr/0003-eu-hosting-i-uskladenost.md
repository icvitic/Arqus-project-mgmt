# ADR-0003: EU hosting i usklađenost

- **Status:** prihvaćeno · **Datum:** 2026-11-08

## Kontekst
Kupci su javne institucije i istraživačke organizacije s obvezama prema GDPR-u, NIS2 / Zakonu o kibernetičkoj sigurnosti i pravilima EU programa (povjerljivost prijava, objava uporabe AI-ja).

## Odluka
- Svi podaci i obrada isključivo u EU (EU regija velikog pružatelja ili EU suvereni oblak); Kubernetes radi prenosivosti, Terraform + GitOps.
- AI isključivo preko EU-hostanih LLM servisa, bez treniranja na podacima kupca, s oznakom i dnevnikom AI sadržaja.
- Od prvog dana: OWASP ASVS L2, MFA, revizijski zapis, enkripcija u mirovanju i prijenosu, sigurnosne kopije (RPO 1 h / RTO 4 h). ISO/IEC 27001 u fazi 3. WCAG 2.1 AA.

## Posljedice
Nešto viši trošak infrastrukture; jaka prodajna prednost prema javnom sektoru.
