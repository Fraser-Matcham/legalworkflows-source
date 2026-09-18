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
| 5 | Public origin | **`https://legalworkflows.co.uk`**, the bare domain |
| 6 | Auth email delivery | **AWS SES**, not Resend |

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
- Object storage is replicated and its restore is proven, not assumed
  (ticket 2095, drilled 18 September 2026 by recovering a deleted document).
  The database half of that claim did **not** survive the drill: the Supabase
  Free plan has no accessible backups and none were self-managed, so there is
  currently nothing to restore. `docs/runbooks/restore.md` opens with it.

Add a staging environment when there are users whose data justifies it.

### 4. Supabase is retained — this corrects the option as offered

The AWS option was presented with "RDS/Aurora → Postgres". That is not
reachable without rewriting the authentication system. `audit.md`, finding 3,
has the evidence: 43 foreign keys to `auth.users`, GoTrue providing OAuth and
MFA, 65 backend files using the Supabase client.

Supabase therefore stays as managed Postgres and identity. AWS provides
compute, object storage, CDN, DNS, TLS and secrets.

> **Superseded on 17 September 2026 by stage 5** (`plan.md`, "Stage 5 — run
> the platform on AWS"). The reasoning above was right about Cognito and
> wrong about "RDS": the evidence that made Cognito unreachable — 43 foreign
> keys to `auth.users`, GoTrue's OAuth and MFA — is exactly what running
> GoTrue and PostgREST ourselves, against RDS, preserves. Supabase is three
> open-source containers plus a managed database; stage 5 runs the same
> three in this account with no application change, which retires the
> credential failure that stopped deploys 12 to 14. The modules are
> `infra/modules/{database,keys,postgrest,gotrue,dbtools}` and the
> procedures `docs/runbooks/platform-migration.md` and
> `platform-cutover.md`. Until the cutover, this decision still describes
> the running service.

### 5. The public origin is `https://legalworkflows.co.uk`

Registered by the operator on 12 September 2026. `.co.uk` over `.com`: the
market is UK law firms, and a UK registration reads as native to them.

**The bare domain, not `app.` or any other subdomain.** This is not a
presentational choice — it follows from "Why one origin" below. The browser
calls `/api` as a relative path and the CDN routes that prefix to the backend,
so the frontend and the API share a single origin and a single certificate.
Whatever origin is chosen is therefore the origin for both, and the bare domain
is the simpler of the two.

The operator did not state a preference between bare and subdomain, so the
documented default in `human-tasks/stage-1-frontend.md` applies. Reversing it
is cheap until Stage 3 provisions the certificate and CDN distribution against
it, and expensive afterwards; if it is going to change, it should change before
then.

This origin now appears in:

- `frontend/.env.example` as the production `NEXT_PUBLIC_APP_URL`.
- The Word add-in's `REACT_APP_WEB_APP_URL` fallback, in `LoginPage.tsx`,
  `ApiKeyBanner.tsx` and `webpack.config.js`. Those three previously defaulted
  to the upstream project's site, which is what the settled origin unblocked —
  the two deferred trademark-allowlist entries said in terms that "both
  defaults should change together when the operator's web-app origin is
  settled", and they have been removed now that it is.

Still pointing at the upstream domain, and correctly so: the signup form's
Terms and Privacy links, which need this service's own documents to exist
before they can point anywhere else, and the workflow-contribution copy, which
names where a contributed workflow is actually published and changes when that
destination does (tickets 2015 and 2016).

### 6. Auth email is sent through AWS SES, not Resend

`human-tasks/stage-2-backend.md`'s Task 5 originally named Resend: it needs no
AWS account, so it was reachable before Stage 3 existed. That is the only
reason it was there — nothing in the code prefers one SMTP provider over
another, and `docs/deployment.md` says as much ("Mike does not require a
Resend API key for these messages").

Revisited once Stage 3 was designed, because decision 4 already keeps
everything else — compute, storage, DNS, secrets — inside one AWS account and
one IAM boundary (see "Why S3 rather than Cloudflare R2" below), and a second
transactional-email vendor bought nothing that justified sitting outside it.
SES's one real cost is the sandbox: a new identity can only send to
individually verified addresses until AWS approves a production-access
request, a manual form with no fixed turnaround. Stage 3, Task 10 is that
request, submitted as early in that stage as the domain allows so the wait
overlaps with the rest of the infrastructure build rather than sitting on the
critical path at the end. **AWS approved it on 16 September 2026**, so the
sandbox is no longer a constraint on anything.

Task 5 in the Stage 2 runbook now points here and to Stage 3, Task 10 rather
than repeating Resend's steps. The domain identity, DKIM records and SMTP
credentials are Terraform's responsibility (the `email` module below), created
once Route 53 holds the zone (Stage 3, Task 7); the operator's part is the one
step Terraform cannot do on their behalf — filing the production-access
request itself.

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
| `dns` | Route 53 zone (created by hand in Stage 3 Task 7, then imported), the two ACM certificates (apex in us-east-1 for CloudFront, `origin.` regional for the ALB) and their validation records; alias records live with the ALB and CloudFront in `backend` and `frontend` |
| `email` | SES domain identity, DKIM records, configuration set for bounce/complaint handling, IAM user scoped to `ses:SendRawEmail` for the SMTP credential |
| `secrets` | Secrets Manager entries, IAM task role and execution role |
| `observability` | CloudWatch log groups, retention, alarms, SNS topic |
| `deploy` | GitHub's OIDC identity provider and the `github-actions-deploy` role (both created by hand in Stage 3 Task 5, then imported), trust narrowed to this repository's `main` and `production` environment, least-privilege deploy policy |

Terraform state lives in a versioned S3 bucket, locked with Terraform's native
S3 lock file rather than a DynamoDB table, created once by hand because state
has to live somewhere before Terraform can manage anything. That is the only
resource created outside Terraform, and Stage 3 says so explicitly.

## What stays outside AWS

| Service | Why |
| --- | --- |
| Supabase | Postgres, Auth, MFA — see decision 4, and its stage 5 supersession: after the cutover these run in the account as RDS, PostgREST and GoTrue |
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
| SES (email, low volume) | <£1 |
| Secrets Manager | £2 |
| Supabase Pro | £20 — until the stage 5 cutover |
| Stage 5, replacing it: RDS `db.t4g.small` single-AZ + 20 GB gp3 + backups | £25–30 |
| Stage 5: PostgREST and GoTrue tasks (0.25 vCPU / 512 MB each) | £12–16 |
| **Total** | **≈ £110–140** (Supabase); **≈ £130–165** (stage 5) |

The NAT gateway and load balancer together are roughly a third of that and buy
no features at this scale — they buy a private network topology. If cost
becomes the binding constraint before traffic does, those are the two to
revisit first.
