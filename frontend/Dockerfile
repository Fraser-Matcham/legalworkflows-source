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
# Next inlines NEXT_PUBLIC_* into the browser bundle at build time, so the
# values the deployed site shows are the ones passed here as build arguments
# (.github/workflows/deploy.yml), not the ones on the running container.
# Empty defaults keep a plain `docker build` working for local use.
ARG NEXT_PUBLIC_APP_URL=
ARG NEXT_PUBLIC_SOURCE_URL=
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SOURCE_URL=$NEXT_PUBLIC_SOURCE_URL
# Next writes a standalone server tree when output: "standalone" is set; the
# runtime stage below copies only that, so node_modules does not ship whole.
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Two things the first ENHANCED scan of this image found, both fixed here
# rather than excused.
#
# The upgrade picks up security patches published since the base image was
# built — three fixable pcre2 findings on the first gated scan, all waiting on
# a Debian point release the base tag had not yet picked up.
#
# Removing npm is the unusual half, and it is only safe because of how this
# stage runs: `CMD ["node", "server.js"]` against Next's standalone output.
# Nothing here invokes npm — not the entry point, and not the release
# pipeline, which runs no task against the frontend container. npm is simply
# along for the ride from the base image, and it brought twelve fixable high
# findings with it: its bundled tar, brace-expansion, ip-address, pacote,
# sigstore and picomatch. Upgrading npm, as backend/Dockerfile does, would
# reduce those to four. Deleting it removes all twelve, and the image gets
# smaller.
#
# If anything here ever needs npm again, this is the line that broke it.
RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Run unprivileged. The base image ships a `node` user for exactly this.
RUN chown -R node:node /app
USER node
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
