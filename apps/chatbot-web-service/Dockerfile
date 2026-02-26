FROM node:20-alpine

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/chatbot-web-service ./apps/chatbot-web-service

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sofia/config run build \
 && pnpm --filter @sofia/observability run build
RUN pnpm --filter chatbot-web-service run build

EXPOSE 3060
CMD ["pnpm", "--filter", "chatbot-web-service", "start"]
