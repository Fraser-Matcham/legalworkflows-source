#!/usr/bin/env bash
# Database tools for the self-hosted platform. Runs inside the dbtools image
# as a one-off Fargate task (infra/modules/dbtools); infra/dbtools/run.sh
# starts one from a laptop. Ticket 2113.
#
# Subcommands:
#   bootstrap      create the Supabase role shape on the RDS instance
#                  (infra/modules/database/bootstrap.sql); idempotent, and the
#                  password-rotation step
#   dump-restore   pg_dump the public and auth schemas from the source
#                  (Supabase) and restore them into RDS, then re-run bootstrap
#                  so the restored objects carry the platform's grants
#   verify         compare source and target: row count per table in public and
#                  auth, and the schema fingerprint (backend/scripts/
#                  schema-fingerprint.sql) of both; non-zero exit on any
#                  difference
#   migrate        apply every backend/migrations file newer than the SSM
#                  record, once, behind an advisory lock — the deploy
#                  pipeline's migrate job, run from inside the VPC
#   fingerprint    print the target's schema fingerprint
#   sql <file|->   run a SQL file (or stdin) against the target as the master user
#   psql-target    the target connection string on stdout (for run.sh --shell)
#
# Environment (set on the task definition by Terraform):
#   DATABASE_MASTER_SECRET_ARN   RDS-managed master credential {username,password}
#   DATABASE_HOST, DATABASE_PORT, DATABASE_NAME
#   DATABASE_ROLES_SECRET_ARN    {AUTHENTICATOR_PASSWORD, AUTH_ADMIN_PASSWORD, …}
#   SOURCE_DB_SECRET_ARN         {SOURCE_DB_URL}: the Supabase session-pooler URI
#   LAST_MIGRATION_PARAM         SSM parameter the migrate subcommand reads and writes
#
# Nothing here prints a password. Connection strings are assembled into
# variables and passed to the PostgreSQL tools directly.
set -euo pipefail

HERE=/opt/legalworkflows
LOCK_KEY=726400101 # the same advisory lock key deploy.yml's migrate job takes

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

secret_json() { aws secretsmanager get-secret-value --secret-id "$1" --query SecretString --output text; }
urlencode() { jq -rn --arg v "$1" '$v|@uri'; }

target_uri() {
    local master
    master=$(secret_json "${DATABASE_MASTER_SECRET_ARN:?}")
    local user pass
    user=$(jq -r .username <<<"$master")
    pass=$(jq -r .password <<<"$master")
    printf 'postgres://%s:%s@%s:%s/%s?sslmode=require' \
        "$(urlencode "$user")" "$(urlencode "$pass")" \
        "${DATABASE_HOST:?}" "${DATABASE_PORT:-5432}" "${DATABASE_NAME:-postgres}"
}

source_uri() {
    local src
    src=$(secret_json "${SOURCE_DB_SECRET_ARN:?}")
    jq -er .SOURCE_DB_URL <<<"$src" >/dev/null 2>&1 \
        || die "the migration-source secret has no SOURCE_DB_URL key (Stage 5, Task 2)"
    jq -r .SOURCE_DB_URL <<<"$src"
}

cmd_bootstrap() {
    local target roles
    target=$(target_uri)
    roles=$(secret_json "${DATABASE_ROLES_SECRET_ARN:?}")
    log "bootstrap: creating the role shape on ${DATABASE_HOST}"
    psql "$target" -X -v ON_ERROR_STOP=1 \
        -v authenticator_password="$(jq -r .AUTHENTICATOR_PASSWORD <<<"$roles")" \
        -v auth_admin_password="$(jq -r .AUTH_ADMIN_PASSWORD <<<"$roles")" \
        -f "$HERE/bootstrap.sql"
    log "bootstrap: done"
}

cmd_dump_restore() {
    local source target dump=/tmp/platform.dump
    source=$(source_uri)
    target=$(target_uri)

    # Refuse to restore over data. A rehearsal or a cutover starts from an
    # instance that has been bootstrapped and nothing else; anything else is
    # a restore into a live database, which is docs/runbooks/restore.md's
    # job and a different decision.
    local tables
    tables=$(psql "$target" -XAtq -c "select count(*) from pg_tables where schemaname in ('public','auth')")
    [ "$tables" = "0" ] || die "the target already has $tables tables in public/auth; refusing to restore over them"

    log "dump: public and auth schemas from the source"
    # Custom format so pg_restore can run it in one transaction and report
    # exactly which object failed. --schema takes only these two: the rest of
    # a Supabase database (storage, realtime, graphql, vault, extensions) is
    # not ours and has nothing to run here. Ownership is kept — the auth
    # schema's objects must belong to supabase_auth_admin for GoTrue's later
    # migrations to alter them — which is why bootstrap made the master user a
    # member of that role.
    pg_dump "$source" --format=custom --schema=public --schema=auth \
        --no-publications --no-subscriptions --no-security-labels --no-tablespaces \
        --file="$dump"
    log "dump: $(du -h "$dump" | cut -f1)"

    # bootstrap created an empty auth schema so its privileges could be
    # declared; the dump carries its own CREATE SCHEMA auth, so the empty one
    # goes first. The re-run of bootstrap afterwards puts the grants back.
    psql "$target" -X -v ON_ERROR_STOP=1 -c "drop schema if exists auth cascade"

    log "restore: into ${DATABASE_HOST}"
    pg_restore --dbname="$target" --single-transaction --exit-on-error \
        --no-publications --no-subscriptions --no-security-labels --no-tablespaces \
        "$dump"
    rm -f "$dump"
    log "restore: done; re-applying the platform grants"
    cmd_bootstrap
}

count_rows() {
    # One line per table: schema.table<TAB>count, sorted. Exact counts, not
    # pg_stat estimates, because the point is to prove equality.
    local uri=$1
    # The first psql prints one statement per table (a tab is passed as a
    # separate %L argument so no quote sits inside the literal); the second
    # runs them.
    psql "$uri" -XAtq -c "
      select format('select %L || %L || count(*) from %I.%I;', n.nspname || '.' || c.relname, E'\t', n.nspname, c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','p') and n.nspname in ('public','auth')
      order by 1" \
    | psql "$uri" -XAtq -f - | LC_ALL=C sort
}

fingerprint() { psql "$1" -XAtq -f "$HERE/schema-fingerprint.sql"; }

cmd_verify() {
    local source target rc=0
    source=$(source_uri)
    target=$(target_uri)

    log "verify: row counts, public and auth"
    count_rows "$source" > /tmp/counts.source
    count_rows "$target" > /tmp/counts.target
    if diff -u /tmp/counts.source /tmp/counts.target > /tmp/counts.diff; then
        log "verify: $(wc -l < /tmp/counts.target) tables, every count matches"
    else
        log "verify: ROW COUNTS DIFFER (source vs target):"; cat /tmp/counts.diff; rc=1
    fi

    log "verify: schema fingerprint (backend/scripts/schema-fingerprint.sql)"
    fingerprint "$source" > /tmp/fp.source
    fingerprint "$target" > /tmp/fp.target
    if diff -u /tmp/fp.source /tmp/fp.target > /tmp/fp.diff; then
        log "verify: fingerprints identical ($(wc -l < /tmp/fp.target) lines)"
    else
        log "verify: FINGERPRINTS DIFFER (source vs target):"; cat /tmp/fp.diff; rc=1
    fi

    log "verify: users who can sign in"
    psql "$target" -XAtq -c "select count(*) || ' users, ' || count(*) filter (where email_confirmed_at is not null) || ' confirmed, ' || count(*) filter (where banned_until > now()) || ' banned' from auth.users"
    psql "$target" -XAtq -c "select count(*) || ' MFA factors, ' || count(*) filter (where status = 'verified') || ' verified' from auth.mfa_factors"

    [ "$rc" = 0 ] && log "verify: PASS" || log "verify: FAIL"
    return "$rc"
}

cmd_migrate() {
    local target param last
    target=$(target_uri)
    param=${LAST_MIGRATION_PARAM:?}
    last=$(aws ssm get-parameter --name "$param" --query 'Parameter.Value' --output text)
    log "migrate: last applied $last"
    mapfile -t pending < <(cd "$HERE/migrations" && ls -1 *.sql | LC_ALL=C sort | awk -v last="$last" '$0 > last')
    if [ "${#pending[@]}" -eq 0 ]; then log "migrate: nothing to apply"; return 0; fi
    log "migrate: applying ${#pending[@]}: ${pending[*]}"

    # The same shape as deploy.yml's job: one session, an advisory lock, each
    # file marked before it runs so a failure midway leaves the record at the
    # last file that completed.
    local args=(-X -v ON_ERROR_STOP=1 -c "select pg_advisory_lock($LOCK_KEY)")
    local f
    for f in "${pending[@]}"; do
        args+=(-c "\\echo -- applying $f" -f "$HERE/migrations/$f")
    done
    if psql "$target" "${args[@]}" 2>&1 | tee /tmp/migrate.log; then
        aws ssm put-parameter --name "$param" --type String --overwrite --value "${pending[-1]}" >/dev/null
        log "migrate: applied through ${pending[-1]}"
        return 0
    fi
    local failed idx=-1 i
    failed=$(grep -o 'applying [^ ]*\.sql' /tmp/migrate.log | tail -1 | awk '{print $2}' || true)
    for i in "${!pending[@]}"; do [ "${pending[$i]}" = "$failed" ] && idx=$i; done
    if [ "$idx" -gt 0 ]; then
        aws ssm put-parameter --name "$param" --type String --overwrite --value "${pending[$((idx-1))]}" >/dev/null
        log "migrate: $failed FAILED; record advanced to ${pending[$((idx-1))]}. See docs/runbooks/failed-migration.md"
    else
        log "migrate: $failed FAILED; no earlier pending file completed, record unchanged. See docs/runbooks/failed-migration.md"
    fi
    return 1
}

cmd_sql() {
    local target file=${1:-}
    [ -n "$file" ] || die "sql needs a file path, or - for stdin"
    target=$(target_uri)
    if [ "$file" = "-" ]; then psql "$target" -X -v ON_ERROR_STOP=1 -f -
    else psql "$target" -X -v ON_ERROR_STOP=1 -f "$file"; fi
}

case "${1:-help}" in
    bootstrap)     cmd_bootstrap ;;
    dump-restore)  cmd_dump_restore ;;
    verify)        cmd_verify ;;
    migrate)       cmd_migrate ;;
    fingerprint)   fingerprint "$(target_uri)" ;;
    sql)           shift; cmd_sql "$@" ;;
    psql-target)   target_uri; echo ;;
    help|*)        sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; [ "${1:-help}" = help ] ;;
esac
