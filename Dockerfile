# Builds the visualisation and the API into one image; the API serves both.
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/office/package.json apps/office/
COPY packages/events/package.json packages/events/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @office/web build \
 && pnpm --filter @office/api deploy --prod --legacy /out \
 && cp -r apps/office/dist /out/public

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/public
COPY --from=build /out ./
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "src/server.ts"]
