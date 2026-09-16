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

ENV NODE_ENV=production
EXPOSE 3001
CMD ["npm", "start"]
