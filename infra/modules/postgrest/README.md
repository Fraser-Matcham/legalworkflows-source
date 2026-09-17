# `postgrest`

Row 5.3 of the Stage 5 table (tickets 2114, 2115). PostgREST as a Fargate
service on the existing cluster, answering the backend's data-access calls
against the RDS database. Created only when the root `platform_enabled` is
true.

```
CloudFront ── /rest/v1/* (prefix stripped at the edge, ticket 2123) ──▶ ALB :443
                X-Origin-Verify: <secret>                                 │ rule 30: both headers match
                X-Origin-Target: postgrest                                ▼
                                                              postgrest target group ──▶ task :3000
                                                              health check ──▶ task :3001 /ready
backend task ── http://postgrest:3000 (Service Connect, private, unused today) ──▶ same task
                                                              task ── 5432 ──▶ RDS as `authenticator`
```

## Why nothing in the application changes

The backend's 556 `.from(...)` and 39 `.rpc(...)` call sites are supabase-js
calls, and supabase-js speaks to PostgREST: `GET /rest/v1/<table>?select=…`
with the API key in `apikey` and a JWT in `Authorization`. PostgREST reads
the JWT's `role` claim, `SET ROLE`s to it on a pooled `authenticator`
connection, and runs the query. Running the same release ourselves
(`v14.12`, the tag `docker-compose.yml` pins) against the same schema means
every one of those calls keeps working with no change but `SUPABASE_URL`.

## Configuration

| Setting | Value | Why |
| --- | --- | --- |
| `PGRST_DB_URI` | `AUTHENTICATOR_URI` from `<prefix>/database/roles` (secret) | the connection role the `database` module minted |
| `PGRST_JWT_SECRET` | `JWT_SECRET` from `<prefix>/platform/jwt` (secret) | the same secret GoTrue signs with, so a GoTrue session token is a valid PostgREST token |
| `PGRST_DB_SCHEMAS` | `public` | the only schema the backend queries; `auth` stays unexposed |
| `PGRST_DB_EXTRA_SEARCH_PATH` | `public,extensions` | the schema the bootstrap installs `pg_trgm` and `pgcrypto` in, as Supabase does, so a restored dump's references resolve |
| `PGRST_DB_ANON_ROLE` | `anon` | the role for a request with no JWT, which every table denies |
| `PGRST_DB_POOL` | 10 per task | two tasks at most leaves the t4g.small's default `max_connections` mostly free for GoTrue and the tooling |
| `PGRST_ADMIN_SERVER_PORT` | 3001 | `/live` and `/ready` for the load balancer |
| `PGRST_OPENAPI_MODE` | `disabled` | the root path stops describing the schema to anyone with a key |
| `PGRST_LOG_LEVEL` | `warn` | request logging at `info` would put a line per backend query in CloudWatch |

## Choices worth knowing about

**The health check is `/ready`, not `/live`, on the admin port.** The
backend's target group deliberately checks process liveness so a dependency
blip cannot cycle its tasks. PostgREST is the other way round: a task with a
dead database pool has nothing to serve, so it should leave rotation until
the pool recovers. `/ready` answers 200 only with a working connection and a
loaded schema cache.

**Why through the edge.** The backend could reach PostgREST as
`http://postgrest:3000` over Service Connect without leaving the VPC, and the
name is published for that. It does not, for one reason: supabase-js takes
one base URL and appends `/rest/v1` and `/auth/v1` to it, and neither
PostgREST nor GoTrue can serve under a prefix. Something has to route by
path, and CloudFront already does exactly that for `/api` with a function
that strips the prefix. Adding `/rest/v1` and `/auth/v1` behaviours there
(ticket 2123) reuses the header gate the backend's origin has, gives the
platform TLS for free, and keeps `SUPABASE_URL` an ordinary `https://` value
— the public origin. The cost is that the backend's database traffic leaves
through the NAT gateway and comes back through CloudFront, which is the path
it takes to Supabase today. An internal nginx gateway task (the shape
`supabase/gateway.conf` runs locally) would remove that round trip and take
`/rest/v1` off the public internet; it is the follow-up if either matters.

**What a public `/rest/v1` exposes.** The same thing Supabase's did: a REST
endpoint reachable by anyone holding the `anon` key, which reaches nothing —
every table is revoked from `anon` and `authenticated` (`scripts/check-schema-privileges.mjs`)
and thirty carry deny-all RLS. The key is not in any browser bundle, because
the frontend never talks to Supabase. The `service_role` key is in one
place, the backend's task definition.

**Pinned image from the public ECR gallery.** `public.ecr.aws/supabase/postgrest:v14.12`
is the same release as the Docker Hub tag in `docker-compose.yml`, without
Docker Hub's anonymous pull limit, which a Fargate task pulling through a
NAT gateway would share with everyone behind that address. Bump both
together and re-run the stack tests.

**Deploys are Terraform.** Nothing registers task definitions for PostgREST
outside Terraform: the image is a pinned upstream release, so a new version
is an edit to `image` and an apply. Only `desired_count` is ignored, for
autoscaling.

**Read-only root filesystem.** The image is built from scratch — one static
binary — so there is nothing to write and nothing to lose by saying so.

## Row-level security: the policy migration

`backend/migrations/20260917_01_service_role_rls_policies.sql` (and the same
block at the end of `backend/schema.sql`) gives `service_role` a permissive
policy on each of the thirty RLS-enabled tables. It exists because the RDS
master user cannot grant `BYPASSRLS` (see the `database` module's README),
and without it every backend query against the restored database returns
zero rows. It names `service_role` only, so `anon` and `authenticated` are
exactly as denied as before; the stack tests' leak sweep and the
schema-privileges gate both still hold, and on Supabase, where
`service_role` bypasses RLS anyway, it is inert.

## Verifying it

After the apply, from anywhere:

```sh
npm run --silent platform-keys -- verify --key "$ANON_KEY" --role anon \
    --against https://legalworkflows.co.uk
```

asks `/rest/v1/` with the key and reports whether PostgREST accepted it
(`docs/runbooks/api-keys.md`). Before the CloudFront behaviours exist, the
target group's health status in the console is the check: a healthy target
means PostgREST reached the database as `authenticator` and loaded the
schema.

## Alarms

The `observability` module adds PostgREST to its per-service set once it
exists: unhealthy targets and no running task (urgent), CPU and memory
(informational). The runbooks are the same as the backend's.

## Inputs and outputs

See `variables.tf` and `outputs.tf`. `security_group_id` is what the
`gotrue` module does not need — GoTrue talks to the database, not to
PostgREST — but a future internal gateway would; `service_connect_url` is
the private address for that path.
