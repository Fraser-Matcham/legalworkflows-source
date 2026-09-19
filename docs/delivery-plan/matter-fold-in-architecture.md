# Architecture, topology, and codebase structure

How the unified product should be hosted, and what this repository must
change before it can carry live matters. Companion to the
[fold-in plan](matter-fold-in.md) and the
[compliance annex](matter-fold-in-compliance.md). Decisions D1–D17 in
the plan are assumed.

This is a research report against the trees as of 19 September 2026, not
a certificate and not a licence to copy Grails.

---

## Recommendation

**Stay on this repository's existing topology. Complete Stage 5. Add
matter capabilities as additive TypeScript modules. Do not introduce a
second runtime, a second origin, a second identity store, or a second
database.**

Concretely:

| Layer | Take | Do not take |
| --- | --- | --- |
| Public edge | Existing CloudFront, one cert, path routing of `/api`, `/auth/v1`, `/rest/v1` | Vercel SPA, `app.` subdomain, internet-facing API as the browser origin |
| Compute | Existing two Fargate services (Next.js + Express). Same cluster for Stage 5 GoTrue and PostgREST | A Tomcat/Grails service, a third Express, Lambda for conversion |
| Identity | GoTrue (hosted today, Fargate after cutover). Microsoft as a GoTrue external provider when a firm needs it (D6) | LMM `UserAuthToken`, a parallel cookie, Cognito |
| Data | Postgres 17.6 on RDS after Stage 5; Express still talks HTTP to PostgREST as `service_role`; deny-all RLS for browser roles | LMM RDS, Liquibase, GORM, a second schema |
| Files | Existing S3 SSE-KMS document pipeline. Matter posts stay links/notes | Replacing documents with LMM `Post.url` |
| Jobs | Existing Postgres `db_jobs` (`FOR UPDATE SKIP LOCKED`), in-process worker thread | Redis/ElastiCache to start; in-request notification fan-out like LMM |
| UI | App Router + liquid-glass / shadcn. Taskmap/roadmap as new client modules | MUI, Redux, HashRouter, `juralio-theme` |
| Licence boundary | Reimplement from the LMM data model. `scripts/check-repo-boundary.mjs` stays red on a cross-repo import | Copying Groovy, a submodule, a `file:` dependency |

The fold-in is seven capabilities this service does not have
(matter boundary, membership, workstream/task/post tree, costs math,
taskmap/roadmap, workstream templates, in-app inbox) **inside a stack
that already has** documents, LibreOffice, the assistant, the Word
add-in, CloudFront, GoTrue, tenancy CI, and a deploy pipeline. Hosting
them does not require a new kind of computer. It requires finishing the
platform this repo already described, then adding files this repo's
fork rules already tell you how to add.

---

## Why this topology, measured

Three facts, not preferences:

1. **The product frontend already imposes one origin.**
   `frontend/src/app/lib/mikeApi.ts` hard-codes `API_BASE = "/api"`.
   HttpOnly `__Host-` cookies only work on that hostname. Architecture
   decision 5 (`v2/architecture.md`) exists because of this. A Vercel
   SPA talking to a public ALB, which is how LMM is wired, would break
   it or force a second cookie.

2. **LibreOffice already forces Fargate, not Lambda.** Conversion is
   large, stateful, and in the backend image (`libreoffice-writer`).
   The backend task is already sized for it (1024 CPU / 2048 MiB).
   Matter work does not add a second conversion fleet. LMM has no
   LibreOffice at all — its "documents" are URLs on posts.

3. **A second production is a second ISMS scope.** LMM production
   Terraform has never been applied. Applying it, or running Grails
   beside Express, recreates the identity-mapping problem (backlog
   2069) and the dual-processor problem the fold-in exists to avoid.
   Decision D5 already put Stage 5 RDS on the critical path of every
   launch gate; that is the database the matters will live in.

Rejected alternatives remain those in the fold-in plan (HTTP seam,
reverse fold, Grails sidecar, MUI SPA mount, GORM translation). This
document does not reopen them.

---

## Target runtime topology

Stage 5 live, which decision D5 requires before Gate A. Until cutover
the *boxes* are the same with hosted Supabase standing in for RDS +
GoTrue + PostgREST — but that configuration cannot open a gate.

```
Browser
  │ HTTPS
  ▼
CloudFront  (eu-west-2 origin, us-east-1 ACM, PriceClass_100)
  │  /              → frontend (Next.js :3000)
  │  /api/*         → strip /api → backend (Express :3001)
  │  /auth/v1/*     → strip prefix → GoTrue :9999
  │  /rest/v1/*     → strip prefix → PostgREST :3000
  │  X-Origin-Verify + X-Origin-Target on every origin
  ▼
ALB :443  (public subnets; SG = CloudFront prefix list only)
  ▼
ECS Fargate  cluster legalworkflows-production  (private subnets, no public IPs)
  ├── frontend   512 CPU / 1024 MiB   USER node
  ├── backend    1024 CPU / 2048 MiB  LibreOffice + Express + db_jobs thread
  ├── gotrue     256 CPU / 512 MiB    v2.189.0  (Stage 5)
  └── postgrest  256 CPU / 512 MiB    v14.12    (Stage 5)
         │
         ├── RDS Postgres 17.6  db.t4g.small  TLS  35-day backups  eu-west-2
         ├── S3 documents  SSE-KMS  + 35-day replica bucket
         └── SES  no-reply@legalworkflows.co.uk
```

Unchanged from today: one NAT, two AZs, Service Connect
`{prefix}.local` for frontend→backend SSR, secrets in Secrets Manager,
ECS Exec **off**, deploy via GitHub OIDC.

**Not in this picture, and not added for the fold-in:**

- Redis / ElastiCache. Production already runs `QUEUE_DRIVER=postgres`.
  Add it when `db_jobs` poll latency is the measured bottleneck, not
  because LMM had `@Scheduled` methods.
- A dedicated worker service. `WORKERS_MODE=thread` already takes
  conversion off the HTTP loop. Split `node dist/worker.js` onto a
  second service **of the same image** only after LibreOffice starves
  `/health`. Same codebase, different command.
- OpenSearch / Elasticsearch. LMM search is `LIKE '%token%'` plus
  in-process `contains`. Rebuild as SQL scoped by `matterAccess`,
  not a new cluster.
- A staging account. Architecture decision 3 is still "production
  only". Matter schema goes out behind the schema-drift gate and
  synthetic data (D1). A staging environment becomes justified when
  Gate B has a paying firm, not to host the fold-in itself.
- Word-add-in hosting. Still in-tree, still not a production surface
  in Phases 2–6. Phase 8 may pass `matter_id` in existing chat
  payloads.

Microsoft SSO (Phase 3, decision D6) is a GoTrue external provider
(`GOTRUE_EXTERNAL_AZURE_*` or the equivalent in v2.189.0) plus org
wiring in Express. It is not a new Fargate service. There is no Azure
provider in this repo today — Google is the only external IdP in
`infra/modules/gotrue`.

---

## Target process model

Keep **two long-running Node processes** plus the Stage 5 auth/data
plane.

| Process | Owns | Must not own |
| --- | --- | --- |
| Next.js | App Router, liquid-glass UI, taskmap/roadmap **layout** (D3 in the browser, as in LMM) | Direct Postgres, secrets, LibreOffice |
| Express | Auth middleware, tenancy, matter CRUD, costs **arithmetic** (pure TS, shared with export), `db_jobs`, LibreOffice, LLM tools | A second cookie, a browser-reachable PostgREST table |
| GoTrue | Users, sessions, TOTP, Google, later Microsoft | Matter roles |
| PostgREST | HTTP to Postgres for the service role | Any `anon` / `authenticated` grant on a matter table |
| `db_jobs` thread | Conversion, extraction, account delete, **matter export**, **notification fan-out**, destroy | Inline `REQUIRES_NEW` inserts of N notification rows on the request that created the event (LMM's pattern — do not copy) |

Browser talks only to CloudFront. Express talks to PostgREST with
`SUPABASE_SECRET_KEY` and **bypasses RLS**; every new handler still
filters on caller identity (`npm run tenancy`). Browser roles stay
revoked (`npm run schema-privileges`).

Costs math runs **once**, in `backend/src/lib/matters/costs/`, imported
by the API and by Excel export. LMM ran it in the SPA
(`revenueHelper.js`) and froze whatever the browser computed. That is
how a wrong total became historical record. The unified product does
not repeat it.

Taskmap/roadmap stay **client-side**. There is no layout service to
host. The API returns a matter-scoped tree; the new React module
partitions it.

---

## Target data architecture

Do not collapse the word "project".

```
organizations
 └── matters                         confidentiality boundary (new)
      ├── matter_members             admin / team / viewer / costs
      ├── matter_workstreams         never named `projects`
      │    └── matter_tasks          levels 1–6, copy/move same matter only
      │         └── matter_posts     notes / meetings / external URLs
      └── projects.matter_id         existing DMS; one default per matter (D3)
```

Invariants that belong in the database, not only in the picker:

- `matter_tasks.workstream_id` → workstream of the same `matter_id`
  (deny cross-matter move even if the UI is wrong). LMM's
  `TaskMoveService` does **not** assert this; the unified product must.
- Unique partial index: one default `projects` row per matter (D3).
- Direct `project_access_grants` on a matter-linked project: forbidden.
  `matter_members` is the source of truth; `checkProjectAccess` and the
  SQL list paths delegate to `matterAccess`. No grant or override cache.
- `legal_hold` blocks destroy **and** deletion of documents, versions,
  and posts (D15: matter admin or org admin, audited).
- Placeholders are not `auth.users` and cannot authenticate.

Search, export, assistant tools, and audit export use
`lib/matters/matterAccess.ts`, the same function as HTTP. A tool that
lists across matters is a defect.

Notification fan-out: write one `matter_events` row on the request
path; enqueue `db_jobs` kind `matter.notify` to insert per-user rows.
Do not copy LMM's synchronous N-row insert, and do not put post bodies
on SES (Phase 7 already forbids that).

---

## Target codebase structure

Not an npm workspace and not becoming one. Four lockfiles stay
(`backend/`, `frontend/`, `word-addin/`, root Playwright). Private
package names stay `mike` / `mike-backend` (fork rule 2).

New files only, names that cannot collide with inherited `projects` /
`workflows`:

```
backend/src/lib/matters/
  matterAccess.ts
  matters.ts
  workstreams.ts
  tasks.ts          # hierarchy mutations; confidentiality assert
  posts.ts
  labels.ts
  templates.ts
  costs/            # Phase 9; pure functions + persistence
backend/src/lib/orgPolicy.ts       # MFA, BYOK/MCP, freeze, provider residency (D10)
backend/src/lib/trustCentre.ts     # facts the Art. 28 pack recites
backend/src/routes/
  matters.ts
  matterWorkstreams.ts
  matterTasks.ts
  matterCosts.ts
backend/src/lib/dbq/handlers.ts    # additive kinds: matter.notify, matter.export, matter.destroy
backend/migrations/YYYYMMDD_NN_matters.sql
backend/schema.sql                 # matching final shape + revokes

frontend/src/app/(pages)/organizations/[id]/matters/
  page.tsx
  [matterId]/
frontend/src/app/components/matters/
  MatterList.tsx
  MatterSidebar.tsx
  TaskList.tsx
  TaskMap.tsx                       # d3-hierarchy in this folder; no juralio-theme
  Roadmap.tsx
frontend/src/app/lib/matterApi.ts   # new client; mikeApi.ts calls it once if needed
frontend/src/app/legal/             # trust centre next to existing /legal
```

Inherited files, one-line edits only:

| File | Touch |
| --- | --- |
| `backend/src/app.ts` | `app.use("/matters", …)` |
| `frontend/src/app/components/shared/AppSidebar.tsx` | nav item "Matters" |
| `docs/api-contract.md` | new mounts |
| `backend/schema.sql` | final shape of the new tables |

Do **not** grow `mikeApi.ts` (2,837 lines) or rename it. Do **not** put
matter UI in `frontend/src/shared/ui/` unless the add-in must render
it (it must not, until Phase 8). Do **not** import from
`frontend/src/app/` inside `shared/ui/`.

Frontend design-system search order is unchanged: `components/ui/` →
`shared/ui/` → `components/shared/` → `modals/` / `popups/` →
`components/matters/`. Informational status is plain text, not
decorative pills.

CI that will see every matter PR, and must stay green:

| Gate | What it demands of new code |
| --- | --- |
| `npm run tenancy` | every handler mentions caller identity |
| `npm run schema-privileges` | every new table revoked from `anon` / `authenticated` |
| `npm run api-contract` | mounts documented |
| `npm run boundary` | no `juralio` / `file:` / submodule |
| `npm run trademarks` | no new user-visible upstream mark |
| `schema-drift.yml` | migration agrees with `schema.sql` |
| `*.crossMatter.test.ts` | named for SRA 6.3, not for a single route |

Matter handlers do **not** go in `scripts/route-tenancy-allowlist.json`
(today: three global catalogue handlers only).

Word add-in: no matter UI in Phases 2–6. Its `mikeApi.ts` stays. Phase
8 may add `matter_id` to existing chat payloads without a new add-in
surface.

---

## Core-repo improvements required to host this

The fold-in does not need a new kind of service. It does need the
platform this repo already designed, plus a small number of hardening
changes that a document-AI beta could defer and a matter processor
cannot.

### Must exist before Gate A (Phases 0–2, decision D5)

These are hosting work, not matter features. They unblock the
container.

| Improvement | Why the current core cannot host matters without it | Where it lives |
| --- | --- | --- |
| **Stage 5 cutover** | Free-plan Supabase has no accessible DB backup. Decision D5: no bridge. 2095 closes when the app runs against restored RDS. | `infra/modules/{database,gotrue,postgrest,keys,dbtools}`, `docs/runbooks/platform-cutover.md` |
| **Non-root backend image** | `frontend/Dockerfile` ends `USER node`; `backend/Dockerfile` does not. Cyber Essentials "secure configuration"; LibreOffice needs a conversion-tested writable profile, not a guess. | `backend/Dockerfile`, security-review leftover |
| **Authenticated live smoke** | `scripts/smoke-test.mjs` is anonymous. Tenancy on the live API is covered only by the unit suite. | extend smoke; one matter-denial case once Phase 2 exists |
| **Trust centre next to `/legal`** | Art. 28 facts (location, sub-processors, export, delete, backup tail) are not a product surface today. | new pages; `docs/data-retention.md` remains the engineering source |
| **`orgPolicy` flags** | No org-level MFA, no BYOK/MCP switch, no provider-residency policy (D10). Flags stored in Phase 2 so Phase 3 can enforce them. | new `backend/src/lib/orgPolicy.ts` |
| **Log-redaction tests for matter fields** | Request log must not grow a matter name, client name, prompt, or post body. The prompt leak is already fixed; the contract must cover the new columns. | tests beside `safeErrorForLog` |
| **`AGENTS.md` rule 1 wording** | Still says "Juralio reaches this service over HTTP". Licence boundary is unchanged; the topology sentence becomes false. Decision D14: Phase 0 PR, not this one. | `AGENTS.md`, delivery-plan README, `v2/architecture.md` decision 2, `status.csv` 2066–2069 (2070 stays Done) |

RDS sizing as already designed (`db.t4g.small`, gp3 20 GB, 35-day
backups, TLS, Performance Insights) is enough for Gate A synthetic /
operator-owned non-client data (D1). Revisit class when a paying firm
exists, not to "prepare for Grails-sized Hibernate".

Backend task size (1024/2048, max 2) is already the LibreOffice size.
Matter request traffic is CRUD and tree reads; it will not be what
OOMs the task. Conversion remains the bottleneck.

### Must exist before Gate B (Phase 3)

| Improvement | Why | Where |
| --- | --- | --- |
| **Org-enforced MFA** | Per-user `mfa_on_login` is optional. Matter-holding orgs default **on**. Matter-linked routes **fail closed** if the MFA column is missing. | `backend/src/middleware/auth.ts` + `orgPolicy` |
| **Session revoke on member removal** | `matter_members` row plus GoTrue session revoke, one transaction. LMM expired tokens on a 30s cron instead. | Express + GoTrue admin API |
| **Org freeze / read-only** | ISO 5.18. LMM injected a fake role; do not copy the enum. An org flag that every matter handler reads is enough. | `orgPolicy` |
| **Microsoft SSO, on demand** | Decision D6: not a hard Gate B blocker if the named firm accepts MFA-enforced email login in writing. Build it on GoTrue (`GOTRUE_EXTERNAL_AZURE_*` + redirect `https://legalworkflows.co.uk/auth/v1/callback`), not a Grails `/mslogin`. | `infra/modules/gotrue`, org flag, login UI |
| **Art. 28 terms the operator can sign** | D12: operator owns them, no external counsel. The software still has to emit the facts. | trust centre + `data-retention.md` |

### Should exist as the spine lands (Phases 2 and 4), not as a platform rewrite

| Improvement | Why | Notes |
| --- | --- | --- |
| **Confidentiality CHECK / trigger** | LMM's move service does not assert same-matter. A check constraint or a trigger on `matter_tasks` is cheaper than hoping every caller remembers. | In the Phase 4 migration |
| **Notification fan-out via `db_jobs`** | LMM fans out on the write path and runs `@Scheduled` on **every** task. Two Fargate tasks would double it. | New job kind; idempotent |
| **Matter-scoped export job** | Existing `export.build` is account-scoped. Law Society exit artefact is per matter. | `db_jobs`; tamper-evident manifest already exists |
| **Sidebar + routing** | `NAV_ITEMS` in `AppSidebar.tsx` has no Matters entry. `/projects` stays for unlinked workspaces (D4). | One inherited edit |

### Later — do not build to "host" the fold-in

| Improvement | When it becomes real |
| --- | --- |
| Redis / ElastiCache | Measured `db_jobs` lag under conversion + export + notify load |
| Separate worker service | `/health` suffers during `soffice`; same image, `WORKERS_MODE=none` |
| Staging environment | First paying firm; decision 3 currently forbids it |
| Multi-AZ RDS / second NAT | Availability target a COLP writes into the Art. 28 terms, not a fold-in prerequisite. Current LWF choice matches current LMM-prod-never-applied choice (single-AZ small). |
| OpenSearch | Only if SQL search on a matter-scoped tree is shown to be too slow |
| Instance sysadmin UI | Second customer **and** an ISMS access-rights procedure. Break-glass stays IAM DB access + CloudTrail |
| Word-add-in matter chrome | Phase 8, optional |
| Elasticsearch-style global search across matters | Never — that is the confidentiality bug |

---

## What LMM taught us not to host

Copying these would make this repository worse at the job it already
does.

| LMM choice | Hosting consequence here |
| --- | --- |
| Vercel + public ALB + `/backend` rewrite | Breaks one-origin cookies; Vercel egress is not a security boundary |
| Grails `updateOnStart` | First `lmm-dev` boot ~296s; `DATABASECHANGELOGLOCK` serialises rolling deploys. This repo already has versioned SQL + a migrate job |
| Hibernate on 0.5 vCPU | Wrong size for Node+LibreOffice; do not "right-size" the backend down to the Tomcat guess |
| In-process `@Scheduled` on every task | Duplicate crons the moment `desired_count` > 1 |
| Costs arithmetic in the browser | Frozen wrong snapshots. Pure TS on the server |
| `LIKE '%token%'` union capped at 10k rows | Will scan straight through the confidentiality boundary if reused without `matterAccess` |
| `UserAuthToken` 15-minute inactivity | A second session to map (2069). GoTrue JWT + refresh rotation is the session |
| BYTEA logos in Postgres / S3 for notices only | This service already has a DMS. Posts stay links |
| ECS Exec on by default (dev) | Off here, stays off |
| Applying `environments/prod` | Second ISMS scope in the same AWS account that already mixed the two stacks once |

---

## How this sits on the existing ADRs

`v2/architecture.md` remains right about AWS, this frontend as the
product, one origin, SES, and no Redis at first. Two sentences are now
stale and are Phase 0 work (D14), not a reason to change topology:

- Decision 2 still describes the Juralio HTTP seam as a later track.
  The fold-in supersedes it.
- Decision 4 still describes hosted Supabase as the running service.
  Stage 5 already superseded that on 17 September 2026; D5 makes the
  cutover a fold-in blocker rather than a parallel track.

No new ADR is required for "where does a matter live": it lives in this
Postgres, behind this Express, on this origin. That is the whole
hosting decision.

---

## Mapping onto fold-in phases

| Phase | Architecture work | Code structure work |
| --- | --- | --- |
| 0 | Reword rule 1 / decision 2 (D14); SoA + Art. 30 | None |
| 1 | Stage 5 cutover; non-root image; authenticated smoke; trust centre | `orgPolicy.ts`, `trustCentre.ts` |
| 2 | `checkProjectAccess` **and** `project_access_role` / overview RPCs / `listAccessibleProjectIds` / `listOrgResources` delegate when `matter_id` is set (see below) | `matters` schema + routes + `/organizations/[orgId]/matters` pages + sidebar, **flagged off** until Gate A |
| 3 | GoTrue Azure provider (when a firm needs it); MFA enforce; freeze | login UI, session revoke |
| 4–7 | `db_jobs` kinds for notify / export / destroy | workstreams, tasks, posts, templates, inbox |
| 8 | Provider-residency default (D10) already in orgPolicy | assistant tools on `matterAccess` |
| 9 | — | `lib/matters/costs/` |

If Stage 5 slips, matter **code** can still merge against synthetic
data. Matter **data** that is not synthetic cannot (D1, D5). That is
the hosting constraint; it is not a reason to stand up a second
cluster.

---

## Before execution — factors the phases do not themselves catch

<a id="before-execution"></a>

These are real, in this tree, and would be expensive to discover on the
first matter PR. None of them changes the topology recommendation.
Several of them change the *first* inherited edit and the order of
applies.

### 1. Org inheritance is too wide for a matter — design the hook first

This is the one that would ship an SRA 6.3 defect on day one if ignored.

`checkProjectAccess` (`backend/src/lib/access.ts`): when
`projects.org_id` is set, **every org member inherits Editor**, org
admins inherit Owner, and `project_access_grants` (email grants) **do
not apply** — the schema comment says they are for personal projects
only. Members are narrowed only via `project_org_access_overrides`.

Matters are org-scoped. The default document workspace therefore has
an `org_id`. If we leave `checkProjectAccess` as it is, **every org
member can open every matter's documents**, including chats and
tabular reviews that inherit from the project. Matter membership would
be theatre.

The fold-in plan's original "derived `project_access_grants`" therefore
does not match this codebase. Do not fight the grants table. The
inherited hook is:

- when `projects.matter_id` is set, `checkProjectAccess` (and the
  chat / tabular / document helpers that call it) **delegate to
  `matterAccess` and return**; org inheritance and email grants are
  skipped;
- do **not** write a cache of `project_access_grants` or
  `project_org_access_overrides` unless a later measurement says we
  must; `matter_members` is the source of truth.

That is a small, load-bearing edit to an inherited file **and** to the
SQL that already duplicates the same predicate. `access.ts` documents
the lockstep: `get_chats_overview` mirrors the TypeScript branch for
branch. Fixing only `checkProjectAccess` would 404 the document URL
while still listing the project name, chat, and tabular review to every
org member — or the reverse.

In the same PR as the TypeScript hook:

- `project_access_role` in `backend/schema.sql` (org branch currently
  returns `'editor'` for every `org_members` row). `chat_access_role`
  and `review_access_role` delegate to it;
- `get_projects_overview`, `get_project_summaries`, `get_chats_overview`;
- `listAccessibleProjectIds` (`access.ts` — document search unions every
  org project the user belongs to);
- `listOrgResources` (`orgs.ts` — org workspace; the comment already
  says a name/`cm_number` in that list is the ethical-wall leak).

Write the tests for all of those (`*.crossMatter.test.ts` plus the
existing project-access and overview suites) before any UI. Stryker
mutation testing already targets `access.ts`; budget for that job
going red.

There is no active-org cookie. Matter pages take org id from the URL,
same as `OrganizationWorkspace` (`/organizations/[orgId]/matters`).

### 2. Do not turn the Matters nav on in production until Stage 5 is live

This repository has **one live environment**. Any user who can click
Matters writes rows into the same Postgres that still has no restore
(D5). A feature flag (`matters_enabled`, default **false**, operator
org-override) is a hosting control, not polish. Code can merge; the
sidebar item cannot. There is no `platform_settings` table; existing
product toggles are env vars
(`NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED`). Use the same pattern:
platform env, plus a second env for the operator-org id that may create
synthetic matters before Gate A. Do not hard-code an org UUID.

`docs/delivery-plan/v2/human-tasks/stage-5-platform.md` still says
"Nothing here is needed to go live." Decision D5 superseded that.
Operator Tasks 1 (RDS cost / AZ / backup window) and 2 (database
credentials for the dump) are still outstanding and **block Phase 1
from finishing**. Task 1's written default is 7-day backups;
`infra/modules/database` was described as 35-day to match the object
replica. Resolve that in Task 1 before apply — decision **D17 (a):
35 days**, so the Art. 28 facts pack matches the object replica. PITR
is later hardening, not a Gate A requirement.

Sequence: rehearse cutover → cut over → *then* enable the flag.
Do not apply a matters migration in the middle of the freeze/copy
window. Developing the migration against current Supabase in CI is
fine; it will ride the dump onto RDS.

### 3. Take an upstream sync before the first inherited edit

Upstream is active; the routine is fortnightly
(`docs/upstream-sync.md`). The inherited files the fold-in must touch
(`access.ts`, `app.ts`, `AppSidebar.tsx`, `projects` in `schema.sql`,
and later `toolDispatcher.ts`) are exactly the files a lagging sync
will conflict with. Start from a `main` that has already absorbed
`upstream-main`, so the first matter PR is not also an upstream merge.

`projects.matter_id` is an additive nullable column. If upstream ever
adds a similarly named column, that is a real collision; check
`git diff main..upstream-main -- backend/schema.sql` as part of the
sync, not after the migration has landed.

### 4. Multi-org users, personal workspaces, and timezone

LWF lets one `auth.users` row belong to **many** orgs
(`org_members` unique on `(org_id, user_id)`). LMM made org membership
immutable and singular. Matter membership must always be interpreted
inside `matters.org_id`; a user who is admin at firm A and viewer at
firm B must not see A's tasks under B's session. There is **no**
active-org cookie, header, or profile column today. Org context is
the resource's `org_id` or the URL (`/organizations/[id]`). Matter
routes follow that: `/organizations/[orgId]/matters`. `matterAccess`
takes that org id as `currentOrgId`, not "any membership".

Personal projects (`org_id IS NULL`) stay unlinked (D4). Do not attach
a personal project to a matter without promoting it to that org —
otherwise `checkProjectAccess` would take the email-grant branch and
the matter branch at once.

Timestamps are `timestamptz`. LMM costs and task dates are **calendar
days**. Decision **D16 (a)**: `Europe/London` is the product default,
copied onto the matter at create, org-overridable; store task dates as
dates, not instants. Instant-vs-calendar was already a dozen LMM
defects.

### 5. Limits the edge and the body parser already impose

CloudFront origin read timeout is **60 seconds** (the quota maximum).
SSE heartbeats every 15s are fine; a synchronous "return the whole
matter tree with posts" is not. Conversion is already async for this
reason. Matter export, destroy, costs snapshot, and notification
fan-out belong on `db_jobs`. List/taskmap APIs must be matter-scoped
and paged — 16 × 300 tasks with posts will not be a cute JSON blob.

`express.json` is **50mb** globally. Do not use that as a licence to
PUT a whole workstream. Cap matter routes tighter (the tool-result
path already uses 2mb as a precedent).

`audit_events` has `project_id` and no `matter_id`. Adding the column
is another inherited schema edit; index it. Append-only is a
convention (`grant … update, delete` still exists for `service_role`).
Matter destroy must not `DELETE FROM audit_events`; it may add a
destruction row. Say that in `data-retention.md` in the same PR.

Every new table that `enable row level security` must also get a
`service_role_all` policy (`backend/migrations/20260917_01_service_role_rls_policies.sql`).
On hosted Supabase, `service_role` has `BYPASSRLS` and you would not
notice. After Stage 5, RDS does not, and every handler would see zero
rows. The drift check will not catch a missing policy.

After migrate, PostgREST's schema cache must reload (Stage 5
`postgrest` / dbtools already have this job; a matters migration on
the live platform has to go through that path, not a dashboard
button).

`userDataCleanup.ts` `ORG_CONTENT_TABLES` (and the account-deletion
probes) list `projects`, `documents`, `workflows`, `tabular_reviews`
only. Comments already talk about "matters a partner opened". Phase 2
must add `matters` / `matter_members` in the same PR, or org-delete
will SET NULL past live matter rows.

### 6. Concurrency, accessibility, and the assistant hook

The task tree has no operational transform. Last-write-wins will
silently drop a concurrent indent/move. Give `matter_tasks` an
`updated_at` (or integer `lock_version`) and return **409** on stale
write before Phase 4 UI ships. Same for snapshot freeze (Phase 9
already says gaps block save).

Taskmap is D3 + canvas in LMM. Canvas is not a keyboard surface.
Phase 4's task **list** is the accessible product; the map is
progressive enhancement. Do not ship a map-only workstream view.

Phase 8 tools must not be edited into the middle of
`toolDispatcher.ts` (large, inherited, untested core). New file,
called once, same `matterAccess`. Prompt injection via a task post
into a matter-linked tool is an LPP issue; treat post bodies as
untrusted input to the model, same as document text.

### 7. What is *not* a pre-execution blocker

Microsoft SSO (no `GOTRUE_EXTERNAL_AZURE_*` in Terraform today) waits
on D6 / Phase 3. Redis, a worker service, staging, Multi-AZ, and
OpenSearch remain later. TipTap, if needed, stays in the feature
folder with sanitisation; it is not a platform choice. The Word add-in
does not need a matter UI to start.

