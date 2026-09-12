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
| 1.1 | Sever the backend type import: re-declare the nine symbols in `frontend/src/app/components/shared/types.ts` | new |
| 1.2 | Add a CI check that fails on any new `backend/src` import from `frontend/` — the same shape as `npm run boundary` | new |
| 1.3 | Rewrite `frontend/Dockerfile` for a frontend-only build context | new |
| 1.4 | Create `frontend/.env.example` documenting all three variables, with a startup guard that fails fast on a missing required one | new |
| 1.5 | Replace the inherited mark with the new one | 2032 |
| 1.6 | Generate favicon, Open Graph image and add-in ribbon icons from the new mark | 2032 |
| 1.7 | ~~Frontend coverage ratchet, matching the backend's~~ — **already in place.** `frontend/vitest.config.mts` gates `src/app/lib/**` at 100/99/100/100 and the CI frontend job runs `test:coverage`. This row cited 2089, which is a *backend* ticket (closed by 2090–2092); there was never a separate frontend ticket. | — |
| 1.8 | Close 2053/2054 as decided; record the decision in the backlog | 2053, 2054 |

### Done when

- `docker build -f frontend/Dockerfile frontend/` succeeds with the
  **frontend directory alone** as context.
- `npm run frontend-boundary` fails if anyone reintroduces a backend import.
- Every surface in `docs/rebrand-verification.md` shows the new mark.
- Frontend tests, lint and build stay green.

### Blocked on your runbook

The brand decisions (accent colour, favicon confirmation) and the domain name.
Domain is needed in stage 3, but buying it early means DNS propagation is not
on the critical path later.

## Stage 2 — Backend

**Goal: the backend has no known gaps, and its HTTP surface is a contract the
frontend can be deployed against independently.**

### Engineering

| # | Work | Ticket |
| --- | --- | --- |
| 2.1 | ~~Replace `xlsx` with `exceljs`~~ — **recommended won't-do.** The premise does not hold; see "Why 2.1 is not being done" below | 2012 |
| 2.2 | Verify a clean install and the full backend suite from scratch | 2013 |
| 2.3 | Close the remaining audit-trail gaps | 2056 |
| 2.4 | Harden the service-role authorisation boundary — the remaining work beyond the tenancy gate | 2059 |
| 2.5 | Production origin and rate-limit configuration, driven by environment | 2063 |
| 2.6 | ✅ Health and readiness endpoints that distinguish "process alive" from "dependencies reachable" — `/health` unchanged, `/ready` added | 2052 |
| 2.7 | Wire error tracking through the existing redaction helpers | 2084 |
| 2.8 | Service and queue metrics | 2086 |
| 2.9 | Alerts on the silent failure paths named in `docs/data-retention.md` | 2087 |
| 2.10 | Publish the API contract the frontend builds against | 2068 (adapted) |

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
| 3.1 | `infra/` Terraform skeleton, remote state, provider pinning | 2045, 2047 |
| 3.2 | `network` module | new |
| 3.3 | `storage` module — document bucket, CORS, lifecycle | 2042, 2043 |
| 3.4 | `secrets` module — Secrets Manager, task roles, least privilege | 2045, 2046 |
| 3.5 | `backend` module — ECR, ECS, Fargate service, ALB | 2049, 2050, 2051 |
| 3.6 | `frontend` module — Fargate service, CloudFront, path routing | new |
| 3.7 | `dns` module — Route 53, ACM, validation | new |
| 3.8 | `observability` module — log groups, alarms, SNS | 2085 |
| 3.9 | GitHub OIDC role, so deploys use no long-lived AWS keys | new |
| 3.10 | Verify the signed-URL round trip against real S3 | 2044 |
| 3.11 | Backups configured and a restore actually proven | 2094, 2095 |
| 3.12 | Runbooks for the common failure modes | 2096 |

### Done when

- `terraform plan` is clean against a real AWS account.
- `terraform apply` from empty produces a working footprint.
- A document uploaded through the API round-trips through S3 and downloads via
  a signed URL.
- A Supabase restore has been performed, not assumed.

### Blocked on your runbook

The AWS account, billing, the Terraform bootstrap bucket, DNS delegation, and
every secret value. This is the longest runbook of the four.

## Stage 4 — Deployment, CI and launch

**Goal: the application is live, deploys are automated and reversible, and
going live has been rehearsed rather than attempted.**

### Engineering

| # | Work | Ticket |
| --- | --- | --- |
| 4.1 | Frontend production environment values, resolved against the real CloudFront origin | stage-1 carryover |
| 4.2 | Build-and-push workflow for both images, on merge to `main` | 2050 |
| 4.3 | Deploy workflow: migrate, then start, then health-gate, then shift traffic | 2051, 2052 |
| 4.4 | Rollback that has been tested by rolling back | 2052 |
| 4.5 | Make the security suites required checks | 2024, 2025 |
| 4.6 | Corresponding Source mirror pipeline, and gate deploys on it | 2073, 2074, 2075 |
| 4.7 | Serve the source offer from the running UI | 2076 |
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
| 2012 | assumed done | **open** — `spreadsheet.ts` still imports `xlsx` |
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
