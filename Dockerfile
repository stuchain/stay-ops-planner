# syntax=docker/dockerfile:1
# Production-style image: workspace install + Next build.

FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Hoisted node_modules in the image so each package's `pnpm run build` / `tsc` resolves reliably (pnpm isolated linker omits per-package typescript binaries otherwise).
RUN printf '%s\n' "node-linker=hoisted" > .npmrc

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/audit/package.json packages/audit/
COPY packages/sync/package.json packages/sync/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/audit packages/audit
COPY packages/sync packages/sync
COPY apps/web apps/web

RUN pnpm --filter @stay-ops/shared build && \
  pnpm --filter @stay-ops/db build && \
  pnpm --filter @stay-ops/audit build && \
  pnpm --filter @stay-ops/sync build && \
  pnpm --filter @stay-ops/web build

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000

CMD ["pnpm", "--filter", "@stay-ops/web", "start"]
