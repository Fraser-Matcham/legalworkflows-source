# Architecture decision record

Decided 10 September 2026. Supersedes the infrastructure assumptions in
`docs/delivery-plan/backlog.csv`.

## Decisions taken

| # | Decision | Chosen |
| --- | --- | --- |
| 1 | Hosting | **AWS, defined in Terraform** |
| 2 | This repository's frontend | **The product frontend** |
| 3 | Environments | **Production only, for now** |
| 4 | Database and identity | **Supabase, retained** (see below) |

### 1. AWS with Terraform

Chosen over a managed PaaS split and over a single VPS. It is the heaviest of
the three to build — that trade was made knowingly. What it buys: everything
that exists is described in code and reviewable in a pull request, nothing is
configured by remembering which dashboard button was pressed, and the
production footprint can be destroyed and rebuilt from the repository.

### 2. This frontend is the product

legalworkflows ships as a standalone product with its own UI. Backlog tickets
2053 and 2054 close as *decided: keep and complete*. The Juralio HTTP seam
(2066–2070) becomes a later, separate track — the API is still treated as a
contract, but Juralio is not on the critical path to going live.

### 3. Production only

One live environment. The local Docker Compose stack is the test environment.

This has one honest cost: **database migrations get no rehearsal against
production-shaped data.** Three things mitigate it, and they should be used
deliberately rather than assumed:

- `terraform plan` rehearses every infrastructure change before it applies.
- The schema-drift CI check builds both installation paths and compares them,
  so a migration that disagrees with `schema.sql` fails before merge.
- Supabase's automated backups, with a restore proven once (ticket 2095)
  rather than assumed.

Add a staging environment when there are users whose data justifies it.

### 4. Supabase is retained — this corrects the option as offered

The AWS option was presented with "RDS/Aurora → Postgres". That is not
reachable without rewriting the authentication system. `audit.md`, finding 3,
has the evidence: 43 foreign keys to `auth.users`, GoTrue providing OAuth and
MFA, 65 backend files using the Supabase client.

Supabase therefore stays as managed Postgres and identity. AWS provides
compute, object storage, CDN, DNS, TLS and secrets.

## The target architecture

```
                          +--------------------------+
    users ----- HTTPS --->|  CloudFront (CDN + TLS)   |
                          |   one origin, one cert    |
                          +-------------+-------------+
                                        |
                    +-------------------+--------------------+
                    |                                        |
              /  (everything)                             /api/*
                    |                                        |
                    v                                        v
        +------------------------+          +---------------------------+
        |  S3 origin bucket      |          |  Application Load         |
        |  Next.js static export |          |  Balancer (internal)      |
        |  + SSR on Fargate      |          +-------------+-------------+
        +------------------------+                        |
                                                          v
                                            +---------------------------+
                                            |  ECS Fargate              |
                                            |  backend container        |
                                            |  (Node 22 + LibreOffice)  |
                                            +------+-------------+------+
                                                   |             |
                        +--------------------------+             +----------+
                        v                                                   v
            +------------------------+                     +----------------------+
            |  Supabase (managed)    |                     |  S3 (documents)      |
            |  Postgres + Auth + MFA |                     |  private, SSE-KMS    |
            +------------------------+                     +----------------------+
```

**Why one origin.** `frontend/src/app/lib/mikeApi.ts` hard-codes
`API_BASE = "/api"`. The frontend and the API must therefore answer on the
same hostname, or every request becomes cross-origin and the HttpOnly auth
cookies stop working. CloudFront doing path-based routing is what satisfies
that. It is a requirement the code imposes, and it was not written down
anywhere before this document.

**Why ECS Fargate and not Lambda.** The backend image installs LibreOffice for
document conversion. It is large, stateful during a conversion, and cannot
start per-request.

**Why no Redis at first.** `QUEUE_DRIVER=postgres` runs the job queue on the
database. One less service to provision, secure and pay for. Add ElastiCache
when queue volume justifies it, not before.

**Why S3 rather than Cloudflare R2.** The code already speaks the S3 API
(`backend/src/lib/storage.ts` uses the AWS SDK), so this is a configuration
change, not a code change — and it keeps the data plane inside one account and
one IAM boundary.

**How the frontend is served.** Next.js needs a Node runtime for its server
components and route handlers, so it is not a pure static upload. It runs as a
second Fargate service behind the same load balancer, with CloudFront in front
caching its static assets. Stage 3 provisions both services from one module.

## What Terraform will own

| Module | Resources |
| --- | --- |
| `network` | VPC, two private subnets, two public subnets, NAT, security groups |
| `storage` | S3 document bucket, SSE-KMS, lifecycle, CORS, block-public-access |
| `backend` | ECR repository, ECS cluster, Fargate service, task definition, ALB, target group, autoscaling |
| `frontend` | ECR repository, Fargate service, target group, CloudFront distribution, cache and path routing |
| `dns` | Route 53 zone, ACM certificate, validation records, aliases |
| `secrets` | Secrets Manager entries, IAM task role and execution role |
| `observability` | CloudWatch log groups, retention, alarms, SNS topic |

Terraform state lives in a versioned S3 bucket with a DynamoDB lock table,
created once by hand because state has to live somewhere before Terraform can
manage anything. That is the only resource created outside Terraform, and
Stage 3 says so explicitly.

## What stays outside AWS

| Service | Why |
| --- | --- |
| Supabase | Postgres, Auth, MFA — see decision 4 |
| GitHub Actions | Already the CI system; deploys via OIDC, so no long-lived AWS keys |
| Model providers | Anthropic, OpenAI, Google — called over HTTPS, keys in Secrets Manager |

## Cost shape

Rough, monthly, at low volume. Presented so the AWS decision is made with open
eyes, not to reopen it.

| Item | Estimate |
| --- | --- |
| ECS Fargate, backend (1 task, 1 vCPU / 2 GB, always on) | £30–40 |
| ECS Fargate, frontend (1 task, 0.5 vCPU / 1 GB) | £12–18 |
| Application Load Balancer | £16–20 |
| NAT gateway | £28–32 |
| CloudFront + S3 (low traffic) | £2–5 |
| Route 53 | £0.40 |
| Secrets Manager | £2 |
| Supabase Pro | £20 |
| **Total** | **≈ £110–140** |

The NAT gateway and load balancer together are roughly a third of that and buy
no features at this scale — they buy a private network topology. If cost
becomes the binding constraint before traffic does, those are the two to
revisit first.
