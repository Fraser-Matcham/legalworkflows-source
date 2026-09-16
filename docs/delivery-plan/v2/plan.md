# Delivery plan v2 — three components to operational

Supersedes the sequencing in `docs/delivery-plan/backlog.csv`. That backlog
remains the ticket register; this document says what order the work happens in
and why, and maps each stage back to its ticket ids.

Read `audit.md` for the evidence behind the sequencing, and
`architecture.md` for the decisions it rests on.

## The shape of the plan

Four stages. Each has engineering work I do, and a numbered runbook of tasks
only you can do. **Every stage is gated: the engineering work of the next
stage cannot finish until the previous stage's human tasks are done**, because
each one hands over something the next stage needs — a domain name, an AWS
account, a set of credentials.

| Stage | Engineering | Your runbook | Gate it opens |
| --- | --- | --- | --- |
| 1 | Frontend: sever the coupling, own its environment, new mark | `human-tasks/stage-1-frontend.md` | Domain and brand decisions |
| 2 | Backend: close the remaining gaps, freeze the API contract | `human-tasks/stage-2-backend.md` | Supabase production project, provider keys |
| 3 | Infrastructure: Terraform the whole footprint | `human-tasks/stage-3-infrastructure.md` | AWS account, DNS delegation, secrets |
| 4 | Deployment, CI and launch | `human-tasks/stage-4-launch.md` | Go live |

Stage 4 returns to the frontend deliberately. Several frontend concerns —
its production environment values, its CDN cache behaviour, its deploy
pipeline — cannot be settled until the infrastructure they run on exists.
Finishing the frontend "completely" in stage 1 would mean guessing at them.

## Stage 1 — Frontend

**Goal: the frontend becomes a component that can be built, tested and
deployed on its own, and it carries our brand rather than the one it
inherited.**

### Engineering

| # | Work | Ticket |
| --- | --- | --- |
| 1.1 | ✅ Sever the backend type import: re-declare the nine symbols in `frontend/src/app/components/shared/apiTypes.ts` (this row's own text named `types.ts`, which was never the file — corrected here) | new |
| 1.2 | ✅ Add a CI check that fails on any new `backend/src` import from `frontend/` — `scripts/check-frontend-boundary.mjs`, run as `npm run frontend-boundary` | new |
| 1.3 | ✅ Rewrite `frontend/Dockerfile` for a frontend-only build context — its own header states "Build context is `frontend/` — this directory alone" | new |
| 1.4 | ✅ Create `frontend/.env.example` documenting all three variables, with a startup guard that fails fast on a missing required one — `frontend/src/app/lib/env.ts` and `frontend/src/instrumentation.ts`, commit 0c82a6d | new |
| 1.5 | ✅ Replace the inherited mark with the new one — `frontend/src/shared/ui/BrandMarkUI.tsx` | 2032 |
| 1.6 | ✅ Generate favicon, Open Graph image and add-in ribbon icons from the new mark — `npm run brand-assets`, drift-checked in CI | 2032 |
| 1.7 | ~~Frontend coverage ratchet, matching the backend's~~ — **already in place.** `frontend/vitest.config.mts` gates `src/app/lib/**` at 100/99/100/100 and the CI frontend job runs `test:coverage`. This row cited 2089, which is a *backend* ticket (closed by 2090–2092); there was never a separate frontend ticket. | — |
| 1.8 | ✅ Close 2053/2054 as decided; record the decision in the backlog — see "Ticket disposition" below: `2053, 2054 | undecided | closed: keep and complete` | 2053, 2054 |
| 1.9 | ✅ Terms of Use and Privacy Policy, and the signup links pointed at them | 2032 follow-on |

### Done when

- `docker build -f frontend/Dockerfile frontend/` succeeds with the
  **frontend directory alone** as context.
- `npm run frontend-boundary` fails if anyone reintroduces a backend import.
- Every surface in `docs/rebrand-verification.md` shows the new mark.
- Frontend tests, lint and build stay green.

### Blocked on your runbook

Nothing remains here. This heading described the brand decisions (accent
colour, favicon confirmation) and the domain name; both are now settled. The
mark was approved and generated (`frontend/src/shared/ui/BrandMarkUI.tsx`,
drift-checked in CI by `npm run brand-assets:check`), and the domain was
registered — `legalworkflows.co.uk`, baked into
`frontend/src/app/lib/operatorDetails.ts`.

## Stage 2 — Backend

**Goal: the backend has no known gaps, and its HTTP surface is a contract the
frontend can be deployed against independently.**

### Engineering

| # | Work | Ticket |
| --- | --- | --- |
| 2.1 | ~~Replace `xlsx` with `exceljs`~~ — **recommended won't-do.** The premise does not hold; see "Why 2.1 is not being done" below | 2012 |
| 2.2 | ✅ Verify a clean install and the full backend suite from scratch — done in a fresh clone, not the working tree | 2013 |
| 2.3 | ✅ Close the remaining audit-trail gaps — project access grants and revocations now audited | 2056 |
| 2.4 | ✅ Harden the service-role authorisation boundary — `uploadSessions` denial tests added; the rest audited and recorded in `docs/testing-coverage.md` | 2059 |
| 2.5 | ✅ Production origin and rate-limit configuration — boot guard for the `ALLOWED_ORIGINS`/loopback gap, production values recorded in `docs/deployment.md` | 2063 |
| 2.6 | ✅ Health and readiness endpoints that distinguish "process alive" from "dependencies reachable" — `/health` unchanged, `/ready` added | 2052 |
| 2.7 | ✅ Wire error tracking through the existing redaction helpers — no SDK, a `console.error` bridge for the ~200 inherited call sites, and the unhandled-rejection raw dump closed | 2084 |
| 2.8 | ✅ Service and queue metrics — `GET /metrics`, token-gated and 404 by default; HTTP, queue and provider instrumented at existing chokepoints. Charting deferred to 3.8, which needs the AWS account | 2086 |
| 2.9 | ✅ Every silent failure path either has a metric to alert on, or is documented as accepted — including a genuinely silent bug this found and fixed (`deleteOrphanedUserStorage`'s bare `catch {}`). Firing an alert rule defers to 3.8, which needs the AWS account | 2087 |
| 2.10 | ✅ Publish the API contract the frontend builds against — `docs/api-contract.md`, gated by `npm run api-contract` | 2068 (adapted) |

### Done when

- `npm run build --prefix backend` and the full suite pass from a clean
  `npm ci`.
- `/health` returns process liveness; `/ready` returns dependency reachability
  and is what the load balancer polls.
- Every failure path in `docs/data-retention.md`'s known-gaps section either
  alerts or is documented as accepted.

### Why 2.1 is not being done

Ticket 2012 reads "replace `xlsx` with `exceljs` — the frontend already uses
exceljs". Three checks against the code say that would be a functional
regression rather than a cleanup.

**ExcelJS cannot produce the formatted display text the module exists to
produce.** Measured, by writing a workbook with date, currency and percentage
formats and reading it back with both libraries:

| Cell | SheetJS `cell.w` (today) | ExcelJS `cell.text` |
| --- | --- | --- |
| Date | `1/3/26` | `Sun Mar 01 2026 00:00:00 GMT+0000 (…)` |
| Currency | `$1,200` | `1200` |
| Percentage | `45.7%` | `0.4567` |

ExcelJS returns the raw value and the `numFmt` *string*, and never applies it.
`spreadsheet.ts` says in its own header that `cell.w` is why SheetJS was
chosen: so "dates and currency reach the model the way a human sees them". A
due-diligence spreadsheet would reach the model with dates as `46082`.

**ExcelJS has no `.xls` reader.** Its `lib/` carries `csv`, `doc`, `stream` and
`xlsx` — no BIFF. The module handles `.xlsx`, `.xlsm` and legacy `.xls` today,
and that is what removed the LibreOffice→PDF→text detour for spreadsheets.
Legacy `.xls` is not rare in legal work.

**"The frontend already uses exceljs" is true but not transferable.**
`frontend/src/app/components/tabular/exportToExcel.ts` only *writes* —
`addWorksheet`, `xlsx.writeBuffer()`. Writing a workbook you constructed and
parsing arbitrary client-supplied ones with display formatting are different
capabilities.

The supply-chain reason for moving is weaker than it first looks, too: the
backend depends on `@e965/xlsx`, a third party's republish of a package
SheetJS de-listed from npm, but `package-lock.json` pins it with a sha512
integrity hash and CI runs `npm ci`, which verifies it. A later malicious
publish cannot reach a build unless someone updates the lockfile.

Doing this properly would mean writing an Excel number-format interpreter —
positive/negative/zero/text sections, date tokens, fractions, conditionals — to
reimplement, worse, what SheetJS already does. The alternatives are accepting
the regression, or carrying two spreadsheet libraries, which defeats the
ticket's own consistency goal.

**Recommendation: close 2012 as won't-do**, and revisit only if SheetJS stops
being maintained.

### Blocked on your runbook

The Supabase production project, and the model-provider API keys. The backend
cannot be configured, let alone deployed, without them.

## Stage 3 — Infrastructure

**Goal: the entire production footprint exists, is described in Terraform, and
can be destroyed and rebuilt from this repository.**

### Engineering

| # | Work | Ticket |
| --- | --- | --- |
| 3.1 | ✅ `infra/` Terraform skeleton, remote state, provider pinning — Terraform 1.16 / AWS 6.x pinned, S3 backend with native lock file (no DynamoDB table), `fmt` + `validate` gated in CI by `.github/workflows/infra.yml` | 2045, 2047 |
| 3.2 | ✅ `network` module — VPC, two public + two private subnets, one NAT (toggle to per-AZ), free S3 gateway endpoint, and the three security groups that make the ALB reachable from CloudFront's prefix list only | new |
| 3.3 | ✅ `storage` module — document bucket with SSE-KMS (customer key, bucket key on), TLS-only policy, CORS from the bare domain, a lifecycle backstop on `upload-sessions/` only (content never expires, per `docs/data-retention.md`), and a least-privilege IAM user + key for the static-credential client | 2042, 2043 |
| 3.4 | ✅ `secrets` module — three Secrets Manager secrets (Terraform-generated tokens, operator-held values set out of band and never through a variable, the storage key), separate backend/frontend execution roles with only the backend's able to read secrets, minimal task roles, `aws:SourceAccount` on every trust policy | 2045, 2046 |
| 3.5 | ✅ `backend` module — ECR with scan-on-push and a keep-ten lifecycle, ECS cluster with Container Insights, Fargate service (1 vCPU / 2 GB, circuit breaker, CPU autoscaling to two tasks, deploys and desired count owned outside Terraform), task definition with the production environment from `docs/deployment.md` and secrets injected from Secrets Manager, the ALB behind two gates (CloudFront prefix list on the security group, secret `X-Origin-Verify` header on the listener with a 403 default), `/health` target group, `origin.<domain>` record, and a Service Connect name so the frontend has a real `API_BASE_URL` | 2049, 2050, 2051 |
| 3.6 | ✅ `frontend` module — ECR, Fargate service (0.5 vCPU / 1 GB) on the shared cluster and listener, CloudFront distribution on the bare domain with the apex A/AAAA records: `/api/*` to the backend origin with the prefix stripped by a CloudFront function, everything else to the frontend origin, `/_next/static/*` cached, every viewer header forwarded, both origins carrying the secret `X-Origin-Verify` header the ALB requires | new |
| 3.7 | ✅ `dns` module — the hand-created hosted zone imported and `prevent_destroy`-protected, two DNS-validated ACM certificates (apex in us-east-1 for CloudFront, `origin.<domain>` regional for the ALB), consumers bind the validated ARN | new |
| 3.8 | ✅ `observability` module — two SNS topics (urgent: site down, with optional SMS; informational: email), thirteen alarms on the load balancer, the ECS services and a readiness-failure log filter, an EventBridge rule for a rolled-back deploy, and the one-page dashboard that is the charting half of 2086; log groups live with their services | 2085 |
| 3.9 | ✅ `deploy` module — the hand-made GitHub OIDC provider and `github-actions-deploy` role imported, trust narrowed to pushes to `main` and jobs in the `production` environment of this repository, `AdministratorAccess` removed by an exclusive-attachments resource, and a least-privilege inline policy: push to the two ECR repositories, register task definitions, update the two services, run the release job, pass the four task roles, invalidate the distribution, read the service logs | new |
| 3.10 | Verify the signed-URL round trip against real S3 | 2044 |
| 3.11 | Backups: ✅ configured — the document bucket is versioned with a one-day noncurrent tail and continuously replicated into a write-locked `backup` bucket under its own key with 35-day retention (`infra/modules/backup`); Supabase's daily backups cover the database. ⏳ The restore drill (`docs/runbooks/restore.md`) runs once the footprint is applied | 2094, 2095 |
| 3.12 | ✅ Runbooks in `docs/runbooks/` — site down, deploy rolled back, database unreachable, storage failure, backend errors, high resource usage, queue backlog, model provider outage, failed migration, certificate expiry, email delivery, and the restore procedure with the drill checklist; every alarm's description names its runbook | 2096 |
| 3.13 | ✅ `email` module (architecture decision 6) — SES domain identity with Easy DKIM, custom MAIL FROM with SPF, DMARC at `p=none`, a TLS-required configuration set with bounce/complaint suppression and events to the alerts topic, and an IAM SMTP user scoped to sending from the domain, its settings stored in Secrets Manager for the Supabase paste-in | new |

### Done when

- ✅ `terraform plan` is clean against a real AWS account — **16 September
  2026**, account `119462788248`, `eu-west-2`.
- ✅ `terraform apply` from empty produces the footprint — 175 resources, one
  imported hosted zone, nothing destroyed. The services have no image until
  the first deploy, so "working" completes with Stage 4.
- A document uploaded through the API round-trips through S3 and downloads via
  a signed URL.
- A Supabase restore has been performed, not assumed.

### As applied

| | |
| --- | --- |
| Account, region | `119462788248`, `eu-west-2` |
| Public origin | `https://legalworkflows.co.uk` (zone `Z01489871T1IGKJ6PISR0`, delegated from GoDaddy) |
| CloudFront | `E1KJB0M380H41R`, `dotjg7yvk6u9q.cloudfront.net` |
| Load balancer | `legalworkflows-prod-alb`, origin `origin.legalworkflows.co.uk` |
| Cluster, services | `legalworkflows-production`, `-backend` and `-frontend` |
| Deploy role | `arn:aws:iam::119462788248:role/legalworkflows-production-github-actions` |
| Egress address | `16.61.111.230` (the single NAT gateway) |
| State | `lmm-terraform-state-119462788248`, key `legalworkflows/production/terraform.tfstate` |

The account is shared with the matter-management platform, which is why the
GitHub OIDC provider is looked up rather than managed here and the deploy
role carries the project prefix.

### Blocked on your runbook

The AWS account, billing, the Terraform bootstrap bucket, DNS delegation, and
every secret value. This is the longest runbook of the four.

## Stage 4 — Deployment, CI and launch

**Goal: the application is live, deploys are automated and reversible, and
going live has been rehearsed rather than attempted.**

### Engineering

| # | Work | Ticket |
| --- | --- | --- |
| 4.1 | ✅ Frontend production values — `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SOURCE_URL` are build arguments in `frontend/Dockerfile`, passed by the release pipeline from the `APP_URL` and mirror variables; `API_BASE_URL` is the backend's Service Connect name from Terraform | stage-1 carryover |
| 4.2 | ✅ `.github/workflows/deploy.yml` builds both images on merge to `main`, pushes them to ECR as `<sha>` and `main`, and refuses an image whose ECR scan has a high or critical finding | 2050 |
| 4.3 | ✅ Same workflow: CI gate on the exact commit → migrations newer than the SSM record, once, behind an advisory lock → catalogue-sync release job from the new revision → rolling update → `/api/ready` through the edge → frontend → `/`. `docs/release-pipeline.md`. ⏳ The first real run is in progress: `config`, `gate` and `mirror` are green on `50a3461`; `build` is blocked assuming the deploy role (`sts:AssumeRoleWithWebIdentity` refused — `infra/modules/deploy/README.md`, "When the role will not assume") | 2051, 2052 |
| 4.4 | Rollback: ✅ `.github/workflows/rollback.yml` (revision numbers from the previous release's summary). ⏳ The test-by-rolling-back needs the footprint applied | 2052 |
| 4.5 | ✅ Make the security suites required checks — done directly in GitHub's branch protection settings for `main`, not by engineering in this repo | 2024, 2025 |
| 4.6 | ✅ Mirror: the pipeline tags each release and pushes the tree and its history to the public mirror *before* building, and stops if that push fails or the mirror is unconfigured. **Proven end to end on 16 September 2026** — `Fraser-Matcham/legalworkflows-source` carries `main` at `50a3461` and the tag `deploy-20260916T172229Z-50a3461`. The token needs *Workflows* as well as *Contents*, because the mirror necessarily carries `.github/workflows/` | 2073, 2074, 2075 |
| 4.7 | ✅ `/legal` offers the Corresponding Source at `NEXT_PUBLIC_SOURCE_URL` — the mirror at the deployed commit, baked in at build time — and falls back to the upstream repository for a build without one; the start-up guard warns when it is unset | 2076 |
| 4.8 | k6 SSE load scenario against production configuration | 2097, 2098 |
| 4.9 | Address what the load test surfaces | 2099 |
| 4.10 | Full suite against production configuration | 2101, 2102 |
| 4.11 | Licence compliance sign-off | 2103 |
| 4.12 | Security review of the combined deployment | 2104 |
| 4.13 | Cutover and smoke test | 2105, 2106 |
| 4.14 | Post-launch monitoring window | 2107 |

### Done when

- A merge to `main` deploys to production with no manual step.
- A rollback has been performed successfully at least once.
- The AGPL Corresponding Source offer resolves to a real, current public
  mirror, and a deploy is blocked if the mirror push fails.
- The smoke test passes against the live domain.

### Blocked on your runbook

Go-live authorisation, the monitoring window, and the licence sign-off, which
is a judgement only the copyright holder can make.

## Ticket disposition

Changes to the register in `docs/delivery-plan/backlog.csv`:

| Ticket | Was | Now |
| --- | --- | --- |
| 2012 | assumed done | **won't-do** — `spreadsheet.ts` still imports `xlsx`, deliberately; see "Why 2.1 is not being done" above |
| 2023 | open | **obsolete** — the add-in is not deferred |
| 2038–2041 | provision Supabase | folded into stage 2's runbook |
| 2053, 2054 | undecided | **closed: keep and complete** |
| 2066–2070 | Juralio seam, critical path | **deferred** to a later track |
| 2039 | staging + production | **production only** for now |

## Copyright and licence

All new work is copyright 2026 **Fraser Matcham**, licensed under the GNU
Affero General Public License v3.0, consistent with `LICENSE` and the notices
at `/legal`. The new brand mark is original work created for this project; the
inherited mark it replaces was upstream's and is not ours to ship.
