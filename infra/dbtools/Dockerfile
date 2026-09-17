# The database-tools image: psql, pg_dump and pg_restore at the PostgreSQL
# version the platform runs, the AWS CLI to read what a task needs from
# Secrets Manager and SSM, and this repository's schema, migrations and
# bootstrap. Ticket 2113; docs/runbooks/platform-migration.md.
#
# Build context is the REPOSITORY ROOT, because the image carries files from
# backend/ and infra/modules/database/:
#
#   docker build -f infra/dbtools/Dockerfile -t dbtools .
#
# It runs as a one-off Fargate task in the private subnets, which is the only
# place the RDS instance is reachable from — there is no bastion and no
# public address (infra/modules/database/README.md). Every subcommand is in
# dbtools.sh; the task's command override picks one.
FROM public.ecr.aws/docker/library/postgres:17-alpine

RUN apk add --no-cache aws-cli bash jq

WORKDIR /opt/legalworkflows
COPY backend/schema.sql schema.sql
COPY backend/migrations/ migrations/
COPY backend/scripts/schema-fingerprint.sql schema-fingerprint.sql
COPY infra/modules/database/bootstrap.sql bootstrap.sql
COPY infra/dbtools/dbtools.sh /usr/local/bin/dbtools

RUN chmod 0755 /usr/local/bin/dbtools \
  && adduser -D -u 10001 dbtools \
  && chown -R dbtools:dbtools /opt/legalworkflows

USER dbtools
ENV HOME=/tmp
ENTRYPOINT ["/usr/local/bin/dbtools"]
CMD ["help"]
