FROM node:20-alpine

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages ./packages
COPY apps/api-gateway-bff ./apps/api-gateway-bff

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sofia/shared-kernel run build \
 && pnpm --filter @sofia/config run build \
 && pnpm --filter @sofia/observability run build
RUN pnpm --filter api-gateway-bff run build

EXPOSE 3000
CMD ["pnpm", "--filter", "api-gateway-bff", "start"]
