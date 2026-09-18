# ponytail: single stage. LibreOffice dwarfs everything, multi-stage saves little.
FROM node:22-slim

# libreoffice-convert shells out to soffice for doc conversion (see
# src/lib/convert.ts). That path converts DOCX to PDF and nothing else, so
# only Writer is installed: the `libreoffice` metapackage additionally pulls
# Calc, Impress, Draw, Base, Math and a Java runtime, none of which this code
# can reach, and each of which carries CVEs into the running image. The first
# scan of the full suite reported 31 high or critical findings and the release
# pipeline refused the image, which was the gate working correctly.
#
# fonts-liberation is explicit because --no-install-recommends drops it, and
# it is what gives Arial and Times New Roman metric-compatible substitutes.
# Without it LibreOffice silently reflows the document and the PDF no longer
# matches the DOCX a client signed off — a correctness problem, not cosmetic.
#
# The upgrade picks up security patches published since the base image was
# built; the base tag is already floating, so this costs no reproducibility
# that `node:22-slim` had not already given up.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       libreoffice-writer \
       fonts-liberation \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Two things this image used to ship that it had no reason to, both found by
# reading the scan rather than by it failing: the gate never blocked on either.
#
# 1. devDependencies. `npm ci` installs them because `npm run build` needs
#    typescript, and nothing removed them afterwards — so Stryker, Vitest,
#    supertest, tsx and prettier all rode into production, and brought
#    qs 6.15.1 and typed-rest-client 2.3.1 with them, which is every moderate
#    advisory `npm audit` reports against this workspace. Express resolves its
#    own qs at 6.16.0, outside the advisory range, so pruning is the whole fix.
#    Verified safe by checking that no file under src/ outside the tests
#    imports any of the thirteen devDependencies.
#
# 2. npm itself. frontend/Dockerfile already deletes it and says why; the same
#    reasoning applies here, and an earlier version of this comment got the
#    reason for keeping it wrong. It claimed the release pipeline runs
#    `npm run sync:workflows` inside this container. It does not:
#    .github/workflows/deploy.yml overrides the container command to
#    ["node","dist/jobs/syncWorkflows.js"] directly. Both package scripts are
#    plain node invocations, so npm was only ever the launcher for CMD, and
#    CMD now calls node itself.
#
#    That removes npm's bundled tar, brace-expansion and ip-address — the four
#    findings scripts/image-scan-allowlist.json was excusing on this image —
#    rather than excusing them, and it removes the `npm install -g npm@latest`
#    line that existed only to keep those copies current.
#
# If anything here ever needs npm again, this is the line that broke it.
RUN npm prune --omit=dev \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/index.js"]
