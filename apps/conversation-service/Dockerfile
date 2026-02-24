FROM node:20-alpine

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/conversation-service ./apps/conversation-service

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sofia/shared-kernel run build \
 && pnpm --filter @sofia/config run build \
 && pnpm --filter @sofia/observability run build
RUN pnpm --filter conversation-service run prisma:generate
RUN pnpm --filter conversation-service run build

EXPOSE 3010
CMD ["pnpm", "--filter", "conversation-service", "start"]
