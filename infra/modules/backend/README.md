# `backend`

Row 3.5 of the Stage 3 table (tickets 2049, 2050, 2051). The API: its image
repository, the ECS cluster and Fargate service, the load balancer and the
rule that lets CloudFront — and only CloudFront — reach it.

```
CloudFront ── /api/* (prefix stripped at the edge) ──▶ origin.<domain> (ALB :443)
                 X-Origin-Verify: <secret>                   │
                 X-Origin-Target: backend                    ▼ rule: both headers match
                                                      backend target group ──▶ Fargate task :3001
frontend task ── http://backend:3001 (Service Connect, private) ──▶ same task
```

## Choices worth knowing about

**Two gates on the load balancer.** The `network` module's security group
admits only CloudFront's address ranges — every distribution in the world.
The listener's default action is a 403, and the forwarding rule requires two
headers only our distribution adds: `X-Origin-Verify`, a random secret, and
`X-Origin-Target: backend`, which says which service the behaviour was for
because the `/api` prefix no longer does. The `frontend` module adds the
matching `frontend` rule and configures CloudFront to send both headers.

**The `/api` prefix is stripped at the edge, not here.** The backend mounts
its routers at the root (`/auth`, `/projects`, …) while the browser calls
`/api/…`. `architecture.md` decided the CDN does that routing; a CloudFront
function in the `frontend` module removes the prefix before the request
reaches this ALB, so the ALB and the task see the paths the code expects.
The frontend's own Node proxy (`frontend/src/app/api/[...path]/route.ts`)
does the same job for local development and is not on the production path.

**Service Connect, for one reason.** The frontend refuses to start without
a valid `API_BASE_URL`, which its server-side proxy would use. Production
traffic never reaches that proxy, but the value has to point somewhere real,
so the backend publishes itself as `http://backend:3001` in a private
namespace and the backend security group admits the frontend on that port.
No traffic uses it today; it is the honest value rather than a decoy, and it
is also what would make routing `/api` through the frontend possible later
without an infrastructure change.

**`/health`, not `/ready`, for the target group.** `/health` is "process
alive"; `/ready` also checks Supabase. If the load balancer checked `/ready`,
a Supabase blip would fail every task's health check and the ALB would
recycle the whole service, turning a dependency outage into a full one.
Readiness gates deploys in Stage 4 instead.

**Deploys happen outside Terraform.** Terraform creates the service with a
task definition pointing at `<repo>:bootstrap`; the Stage 4 workflow builds
an image, registers a new revision and updates the service. The service
ignores drift in `task_definition` and `desired_count` (autoscaling owns the
latter), so an apply never rolls a deploy back. Changing `cpu`, `memory`, the
environment or the secrets list here still produces a new revision and rolls
it out. **On the very first apply** the service exists before any image does;
its tasks fail to pull until the first deploy pushes `bootstrap` (or any tag,
then `image_tag` can follow). That is expected and harmless: the circuit
breaker stops the retry loop, and nothing is reachable through CloudFront
until the `frontend` module's distribution is created anyway.

**Trust two proxy hops.** CloudFront and the ALB each append to
`X-Forwarded-For`; `TRUST_PROXY_HOPS=2` makes the per-IP rate limiters key on
the real client rather than on CloudFront's address, which would otherwise
throttle every user together.

**Sizing.** 1 vCPU / 2 GB per the cost table; LibreOffice conversions are
why it is not smaller. Autoscales on CPU between `desired_count` and
`max_count` (default 2). The conversion pool and the per-user job cap are
per task, so a second task is the cheap step; beyond that, look at what is
actually slow before adding a third.

**Logs live here, alarms elsewhere.** The log group is created in this
module because the `awslogs` driver does not create it and a task with no
group fails to start. The `observability` module attaches alarms to it by
name and owns retention policy beyond the default here.

**Two names are shortened.** The load balancer and its target groups use
`<project>-prod-…` rather than the full prefix, because the ELB API caps
those names at 32 characters and `legalworkflows-production-frontend` is 34.
Everything else in the footprint uses the full prefix. `infra/locals.tf`
explains it, and both modules validate the input so a longer project name
fails at plan time with a readable message rather than at apply.

## Configuration

Non-secret values are environment on the task definition; secrets are
injected by ECS from Secrets Manager via the `secrets` module's
`backend_ecs_secrets` map. `secret_keys` lists which to inject — a key that
is referenced but absent from its secret stops the task from starting, so the
optional operator values (`ERROR_TRACKING_DSN`, `MIKE_WORKFLOWS_GITHUB_TOKEN`,
`COURTLISTENER_API_TOKEN`) are switched on through `extra_secret_keys` (root:
`backend_extra_secret_keys`) only once they have been written. A key that the
`secrets` module does not map fails the plan with a message naming it.

| Set here | Value |
| --- | --- |
| `NODE_ENV`, `PORT`, `TRUST_PROXY_HOPS` | `production`, `3001`, `2` |
| `FRONTEND_URL`, `API_PUBLIC_URL` | `https://<domain>`, `https://<domain>/api` (docs/deployment.md) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | root variables |
| `R2_ENDPOINT_URL`, `R2_BUCKET_NAME`, `R2_REGION` | `storage` module outputs, and the footprint's region — real S3 rejects R2's `auto` (`backend/src/lib/storageRegion.ts`) |
| `MIKE_WORKFLOWS_REPOSITORY`, `MIKE_WORKFLOWS_REF` | root variables — your fork, and a pinned SHA |
| `RATE_LIMIT_*` | the production column of docs/deployment.md's table, as `rate_limits` |
| `ERROR_TRACKING_ENVIRONMENT`, `_RELEASE`, `_SERVER_NAME` | `production`, the image tag, `<prefix>-backend` |

Anything else the backend reads keeps its own default; `extra_environment`
exists for the exceptions.

## Inputs and outputs

See `variables.tf` and `outputs.tf`. Of note: `origin_verify_secret`
(sensitive) is what the `frontend` module puts in CloudFront's origin headers;
`https_listener_arn` is where it adds its rule; `service_connect_backend_url`
is the frontend's `API_BASE_URL`; the `arn_suffix` outputs are for the
`observability` module's metric dimensions.
