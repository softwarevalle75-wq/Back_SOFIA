FROM node:20-alpine

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/orchestrator-service ./apps/orchestrator-service

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sofia/shared-kernel run build \
 && pnpm --filter @sofia/config run build \
 && pnpm --filter @sofia/observability run build \
 && pnpm --filter @sofia/http-client run build
RUN pnpm --filter orchestrator-service run build

EXPOSE 3021
CMD ["pnpm", "--filter", "orchestrator-service", "start"]
