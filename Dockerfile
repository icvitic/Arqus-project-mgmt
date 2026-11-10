# ArQus Projekti – jedna slika: API + izgrađeno web sučelje (ADR-0002/0003). Izgradnja: docker build -t arqus-projekti .
FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm --filter @arqus/api deploy --prod --legacy /out/api

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/web ARQUS_PACKAGES_DIR=/app/paketi
WORKDIR /app/api
COPY --from=build /out/api ./
COPY --from=build /src/apps/api/dist ./dist
COPY --from=build /src/apps/api/drizzle ./drizzle
COPY --from=build /src/apps/web/dist /app/web
COPY --from=build /src/docs/domena/paketi /app/paketi
COPY --from=build /src/VERSION /app/VERSION
# neprivilegirani korisnik iz službene slike; PID 1 / signali: `init: true` u compose ili `docker run --init`
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health/ready || exit 1
CMD ["sh", "-c", "node dist/db/cli.js init && exec node dist/main.js"]
