# Copying the database to the platform

Dump the Supabase project's database — the application's `public` schema and
GoTrue's `auth` schema, which holds every user — and restore it into the RDS
instance, then prove the copy. Ticket 2113; row 5.2 of the stage 5 plan. The
cutover that follows, and the rollback, are
[`platform-cutover.md`](platform-cutover.md).

Everything here runs as a one-off Fargate task in the private subnets, from
the database-tools image (`infra/dbtools`), because that is the only place
the RDS instance is reachable from: there is no bastion and no public
address (`infra/modules/database/README.md`). No client data touches a
laptop.

## Before you start

- The platform is applied (`platform_enabled = true`) and the release
  pipeline has built the dbtools image at least once (`PLATFORM_ENABLED`
  variable set, `Build and scan (dbtools)` green).
- Stage 5, Task 2 is done: the `<prefix>/platform/migration-source` secret
  holds `{"SOURCE_DB_URL": "…"}`, the Supabase project's **session pooler**
  connection string with the password substituted. Session mode, port 5432:
  `pg_dump` needs a session, and the direct database host is IPv6-only,
  which the NAT gateway cannot reach.
- AWS credentials for the account, the AWS CLI, and a checkout of this
  repository for `infra/dbtools/run.sh`.

`run.sh` starts a task, waits, prints its log and exits with the task's exit
code. Each subcommand is one invocation.

## 1. Bootstrap the roles

Once per instance, and again after a password rotation:

```sh
infra/dbtools/run.sh bootstrap
```

Creates the role shape the application expects (`anon`, `authenticated`,
`service_role`, `authenticator`, `supabase_auth_admin` and the placeholders
a Supabase dump grants to), the `auth` and `extensions` schemas, and the
extensions. Idempotent. The log ends with the role table; if the
`service_role` row shows `rolbypassrls = f`, the server refused
`BYPASSRLS` and the policy migration that ships with PostgREST
(`20260917_01_service_role_rls_policies.sql`, already in `schema.sql`) is
what lets the backend read — it is in the dump, so it restores with
everything else.

## 2. Dump and restore

The task refuses to run against an instance that already has tables in
`public` or `auth`: a restore over data is [`restore.md`](restore.md)'s
decision, not this one's. For a rehearsal that is the point — the target
is a clean instance every time.

```sh
infra/dbtools/run.sh dump-restore
```

What it does, in order: `pg_dump --format=custom --schema=public
--schema=auth` from the source; drops the empty `auth` schema the bootstrap
created (the dump carries its own); `pg_restore --single-transaction
--exit-on-error` into the instance; re-runs the bootstrap so the restored
objects carry the platform's grants. Ownership is preserved, which is why
the `auth` tables end up owned by `supabase_auth_admin` — GoTrue's later
migrations need that.

**Nothing else from Supabase comes across.** The storage, realtime,
graphql, vault and extension schemas are Supabase's, and the application
has no call sites into any of them (plan.md, stage 5). A dump that fails on
an object in one of them is a dump that was not restricted to the two
schemas; the command above is.

A single transaction means a failure leaves the instance as it was. Read
the error, fix the cause — a role the bootstrap does not know, an extension
in a schema it did not expect — and run it again.

## 3. Verify

```sh
infra/dbtools/run.sh verify
```

Three checks, against both sides at once:

1. **Row counts, exact, every table in `public` and `auth`.** Any
   difference is printed as a diff and fails the run. While the source is
   live this can differ legitimately (a sign-up between dump and verify);
   during the cutover window it must not.
2. **The schema fingerprint** (`backend/scripts/schema-fingerprint.sql`,
   the same reduction the CI drift check uses) of source and target,
   diffed. Identical means every table, column, constraint, index, policy,
   function, trigger and privilege came across. This is the ticket's
   "schema-drift passes against the restored database": the CI job itself
   compares fresh against upgraded and does not change; this compares
   restored against source.
3. **Who can sign in**: user, confirmed and banned counts, and MFA factor
   counts, printed for the record. The proof that they *can* is the
   smoke path in the cutover runbook, against the running services.

`verify: PASS` and exit 0, or the diffs and exit 1.

## 4. Record it

Date, dump size (in the log), duration, the verify output. The rehearsal's
record is what Stage 5, Task 5 is signed off against.

## Migrations after the cutover

`deploy.yml`'s migrate job applied migrations with `psql` from a GitHub
runner over `SUPABASE_DB_URL`. Nothing outside the VPC reaches the RDS
instance, so once `PLATFORM_SERVES_BACKEND` is set the job runs `dbtools
migrate` as a task instead: the same files, the same advisory lock, the
same SSM record, from the image built at that commit. `failed-migration.md`
applies unchanged; the task's log is in `/ecs/<prefix>-dbtools`.

By hand, the same thing is:

```sh
infra/dbtools/run.sh migrate
```

## Other subcommands

| | |
| --- | --- |
| `run.sh fingerprint` | the target's schema fingerprint alone, to keep or compare later |
| `run.sh sql <file>` | not through `run.sh` — the file would need to be in the image; use `aws ecs run-task` with the `sql` command and `-` on stdin is not possible either. For ad-hoc SQL, add a file to `infra/dbtools/`, rebuild, or use the RDS query editor with the master credential |

## What can go wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| `the migration-source secret has no SOURCE_DB_URL key` | Task 2 not done, or the secret was replaced with a bare string | write the JSON object; `database-unreachable.md` describes the bare-string mistake |
| `pg_dump: error: connection … timed out` | the direct host, not the pooler, or the pooler in transaction mode (6543) | session pooler, port 5432 |
| `pg_restore: error: … role "…" does not exist` | a GRANT to a Supabase role the bootstrap does not create | add it to `bootstrap.sql`'s placeholder list, bootstrap again, re-run |
| `… extensions.gin_trgm_ops does not exist` | the bootstrap did not run, or ran an older version without the `extensions` schema | `run.sh bootstrap`, then re-run |
| `the target already has N tables` | the instance is not clean | a rehearsal wants a fresh instance: `terraform taint 'module.database[0].aws_db_instance.this'` is the blunt way, a snapshot restore of the empty post-bootstrap state the neat one |
| `verify` row counts differ by a few rows in `auth` | the source is live and someone signed in | expected outside the cutover window; inside it, stop and look |
