# ArQus Projekti – jedna slika: API + izgrađeno web sučelje (ADR-0002/0003). Izgradnja: docker build -t arqus-projekti .
# Faza izgradnje radi na arhitekturi stroja koji gradi ($BUILDPLATFORM, BuildKit), a ne ciljne slike: izlaz je čisti
# JavaScript, pa se za arm64 ne mora izvoditi pod emulacijom (QEMU), gdje je `pnpm install` znao zaglaviti satima.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm --filter @arqus/api deploy --prod --legacy /out/api
# Uvjet gornje odluke: produkcijske ovisnosti nemaju izvorne (binarne) module. Ako se to promijeni, izgradnja ovdje staje,
# umjesto da slika za drugu arhitekturu dobije pogrešnu binarnu datoteku.
RUN if find /out/api -name '*.node' | grep -q .; then echo 'Produkcijske ovisnosti sadrze izvorni modul - faza izgradnje vise ne smije biti na BUILDPLATFORM' >&2; find /out/api -name '*.node' >&2; exit 1; fi
# Prazni direktoriji podataka pripremaju se ovdje i kopiraju u završnu fazu, da ona nema nijedan RUN (vidi dolje).
RUN mkdir -p /out/data/documents /out/data/secrets /out/data/offsite

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/web ARQUS_PACKAGES_DIR=/app/paketi
WORKDIR /app/api
COPY --from=build /out/api ./
COPY --from=build /src/apps/api/dist ./dist
COPY --from=build /src/apps/api/drizzle ./drizzle
COPY --from=build /src/apps/web/dist /app/web
COPY --from=build /src/docs/domena/paketi /app/paketi
COPY --from=build /src/VERSION /app/VERSION
# Direktoriji dokumenata, lokalno generiranih tajni i stanja kopija izvan poslužitelja (volumeni preuzimaju vlasništvo iz
# slike). Završna faza namjerno nema nijedan RUN: tada se slika za drugu arhitekturu slaže bez emulacije. Ako RUN ovdje
# ikad zatreba, u .github/workflows/image.yml treba vratiti docker/setup-qemu-action.
COPY --from=build --chown=node:node --chmod=700 /out/data/ /data/
# neprivilegirani korisnik iz službene slike; PID 1 / signali: `init: true` u compose ili `docker run --init`
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health/ready || exit 1
CMD ["sh", "-c", "node dist/db/cli.js init && exec node dist/main.js"]
