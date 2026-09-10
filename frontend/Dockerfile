# Build context is `frontend/` — this directory alone.
#
# It used to be the repository ROOT, because the frontend type-imported nine
# symbols from backend/src and `next build`'s typecheck needed those sources
# present. Those types are now re-declared in
# src/app/components/shared/apiTypes.ts, and scripts/check-frontend-boundary.mjs
# fails CI if the import comes back. See docs/delivery-plan/v2/audit.md.
#
# What that buys: the frontend is a component. It can be built, cached and
# deployed without the backend's source tree, which is what any per-service
# deployment pipeline needs.

FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next writes a standalone server tree when output: "standalone" is set; the
# runtime stage below copies only that, so node_modules does not ship whole.
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Run unprivileged. The base image ships a `node` user for exactly this.
RUN chown -R node:node /app
USER node
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
