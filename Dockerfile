# syntax=docker/dockerfile:1
# Production-style image: full workspace install + Next build (avoids Windows symlink issues with standalone output).

FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/web apps/web

RUN pnpm --filter @stay-ops/shared build && pnpm --filter @stay-ops/db build && pnpm --filter @stay-ops/web build

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000

CMD ["pnpm", "--filter", "@stay-ops/web", "start"]
