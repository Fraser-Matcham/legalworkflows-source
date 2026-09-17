# `database`

Row 5.1 of the Stage 5 table (tickets 2111, 2112). The PostgreSQL instance
that takes over from the Supabase project's database: RDS, engine matched to
the 17.6 in use, in the private subnets, reachable from the platform's own
tasks and from nothing else.

```
private subnets
  PostgREST task  ──5432──▶ ┐
  GoTrue task     ──5432──▶ ├─ database security group ──▶ RDS  legalworkflows-production-db
  db-tools task   ──5432──▶ ┘                                   (no public address, TLS required)
  backend task    ──5432──▶ (admitted; the backend does not connect today)
```

Nothing is created until the root `platform_enabled` variable is `true`. Stage
5 is additive by design (plan.md, "Sequencing") and its first human task is to
approve the running cost, so an apply with the default leaves the footprint
exactly as it was.

## Choices worth knowing about

**RDS, not Aurora.** Aurora's advantages — storage that grows to 128 TB, fast
replicas, cross-region — are for a database that has outgrown one instance.
This one is a few hundred megabytes serving a handful of users, and Aurora's
minimum is roughly twice the price of a `db.t4g.small`. Moving later is a
snapshot restore.

**Engine version pinned to 17.6, minor upgrades automatic.** A dump from the
Supabase project (17.6.x) must restore into the same or a newer minor.
`auto_minor_version_upgrade` lets AWS apply 17.7 and later in the maintenance
window, and the instance's `lifecycle.ignore_changes` on `engine_version`
stops Terraform trying to put it back. A major upgrade is a deliberate edit
with the ignore removed for that apply.

**Single AZ by default.** The rollback target while the move is in progress
is the Supabase project, not a standby; multi-AZ doubles the instance cost
for an availability gain the product does not yet need. Stage 5, Task 1
asks the operator to decide; `multi_az = true` is one variable and an apply
with a brief failover.

**Master password managed by RDS.** `manage_master_user_password` has RDS
generate the credential, keep it in Secrets Manager under this module's KMS
key and rotate it every seven days. Terraform never sees it. No service uses
it: PostgREST and GoTrue connect as the narrower roles below, so a
compromised task credential is not the master credential.

**Backups: 35 days, matching the document bucket.** RDS keeps a daily
snapshot plus continuous transaction logs, so point-in-time recovery reaches
any second inside the window. Thirty-five is the RDS maximum and equals the
`backup` module's retention, so a restore of the database can always be
paired with the object versions of the same moment
(`docs/runbooks/restore.md`). Automated backups survive deletion of the
instance (`delete_automated_backups = false`) and deletion is refused while
`deletion_protection` is on.

**One customer-managed key** for the volume, every snapshot, Performance
Insights and both credential secrets. Copying a snapshot elsewhere needs a
grant on it, which turns an accidental share into an error.

**TLS is not optional.** `rds.force_ssl = 1` in the parameter group refuses
plaintext connections; the URIs this module writes carry
`sslmode=require`. The RSA-2048 CA (`rds-ca-rsa2048-g1`) is the one the
PostgreSQL client libraries in the PostgREST and GoTrue images verify without
an extra bundle.

**No bastion, no public address.** Administrative access is a task in the
private subnets (the database-tools task, ticket 2113), which puts the
session inside the account's logging and makes a connection from a laptop
impossible rather than merely discouraged. The RDS console still offers
query editors and snapshot restores for anyone with the IAM rights.

## The roles

A plain PostgreSQL has none of the roles the application expects; the
Supabase image ships them. `bootstrap.sql` recreates that shape, and the
`<prefix>/database/roles` secret holds the two login passwords and their
connection URIs:

| Role | Login | Used by | JSON keys |
| --- | --- | --- | --- |
| `authenticator` | yes | PostgREST, which then `SET ROLE`s to the JWT's role | `AUTHENTICATOR_PASSWORD`, `AUTHENTICATOR_URI` |
| `supabase_auth_admin` | yes | GoTrue; owns the `auth` schema | `AUTH_ADMIN_PASSWORD`, `AUTH_ADMIN_URI` |
| `anon`, `authenticated`, `service_role` | no | reached by `SET ROLE` only | — |
| `supabase_admin`, `dashboard_user` | no | placeholders some GoTrue migrations grant to by name | — |

Rotating either password is `terraform taint` on the matching
`random_password`, an apply, then `bootstrap.sql` again — it re-sets every
password it names on every run — and a new deployment of the service that
uses it.

## Bootstrapping

Once, after the apply that creates the instance and before any restore or
service start. It runs from inside the VPC as the database-tools task —
`infra/dbtools/run.sh bootstrap` (ticket 2113, `docs/runbooks/platform-migration.md`).
The commands below are what that task runs, shown so the procedure is
readable without it.

```sh
# 1. The master credential RDS keeps (JSON: username, password).
MASTER=$(aws secretsmanager get-secret-value \
  --secret-id "$(terraform output -raw database_master_user_secret_arn)" \
  --query SecretString --output text)
HOST=$(terraform output -raw database_address)
MASTER_URI="postgres://postgres:$(jq -r .password <<<"$MASTER")@$HOST:5432/postgres?sslmode=require"

# 2. The role passwords this module minted.
ROLES=$(aws secretsmanager get-secret-value \
  --secret-id "$(terraform output -raw database_roles_secret_name)" \
  --query SecretString --output text)

# 3. Create the roles, the auth schema and the extensions.
psql "$MASTER_URI" -v ON_ERROR_STOP=1 \
  -v authenticator_password="$(jq -r .AUTHENTICATOR_PASSWORD <<<"$ROLES")" \
  -v auth_admin_password="$(jq -r .AUTH_ADMIN_PASSWORD <<<"$ROLES")" \
  -f infra/modules/database/bootstrap.sql
```

The script prints the role table at the end. Read the `rolbypassrls` column
for `service_role` — see the next section.

## Row-level security on RDS

Thirty tables in `backend/schema.sql` have row-level security enabled with
no policies: deny-all, so a leaked publishable key reaches nothing. On
Supabase the backend's queries pass because `service_role` carries
`BYPASSRLS`. PostgreSQL only lets a genuine superuser confer that attribute,
and the RDS master user is `rds_superuser`, which is not one.

`bootstrap.sql` tries anyway and reports the outcome. If the server refuses,
the equivalent is a permissive policy for `service_role` on each RLS-enabled
table — `to service_role using (true) with check (true)` — which leaves
`anon` and `authenticated` exactly as denied as before. That migration ships
with the PostgREST service (ticket 2115), where it can be tested against a
plain PostgreSQL in CI rather than assumed. Until it has been applied, a
restored database answers every backend query with zero rows, which is the
symptom to recognise.

## What the migration pipeline needs

`deploy.yml` applies migrations with `psql` from a GitHub runner over the
Supabase session pooler. Nothing from outside the VPC reaches this instance,
so after the cutover that job has to run as a task in the private subnets
instead. That change belongs to the routing and configuration cutover
(ticket 2122) and reuses the database-tools task; it is noted here so the
instance's reachability is not "fixed" by opening it to the internet.

## Alarms

The `observability` module attaches two alarms when this module exists: free
storage under 2 GiB (urgent — a full volume goes read-only) and CPU over 85%
for fifteen minutes (informational). `docs/runbooks/database-unreachable.md`
and `high-resource-usage.md` are the runbooks.

## Inputs and outputs

See `variables.tf` and `outputs.tf`. `security_group_id` is what the
PostgREST, GoTrue and database-tools modules add their ingress rules
against; `roles_secret_arn` and `kms_key_arn` are what their execution roles
need to read the URIs; `master_user_secret_arn` is for the bootstrap and a
restore only.
