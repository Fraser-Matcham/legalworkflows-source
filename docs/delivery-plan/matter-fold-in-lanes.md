# Fold-in agent lanes and exclusions

**Read this before starting any execution agent.** Assign **one lane
and one task id**. If two agents would edit the same row in the
[contended file registry](#contended-file-registry), do not start the
second.

Tasks and “done when” live in
[matter-fold-in-tasks.md](matter-fold-in-tasks.md). This file is only
ownership and exclusions. If they disagree, this file wins on *who
may edit which path*; the tasks file wins on *what the PR must do*.

Decisions D1–D17 are assumed. Do not invent product decisions.

---

## Copy-paste brief (required)

Put this block at the top of every agent session. Fill the blanks.
Do not start the agent without it.

```
LANE: <A|B|C|D|E|F|G5|G6|G7|G8|G9|OPS>
TASK: <id, e.g. F2-1>
BASE: main (must include F0-3; if TASK is after F2-1, main must include F2-1)
BRANCH: feature/<task-id>-<short-slug>

YOU MAY EDIT: (paste the lane's "May edit" list — no others)
YOU MAY CREATE: (paste the lane's "May create" list)
YOU MUST NOT EDIT: (paste Global exclusions + the lane's "Must not")
YOU MUST NOT: set MATTERS_ENABLED on production; apply LMM prod Terraform;
import or copy from legal-matter-management*; edit LICENSE; rename
mike_workflows / mikeApi.ts / MIKE_WORKFLOWS_*.

If you need a file not on YOU MAY EDIT / YOU MAY CREATE, stop. Do not
"just touch it." The file belongs to another lane.
```

---

## Global exclusions (every software lane)

No software agent may:

| Forbidden | Why |
| --- | --- |
| Any path under the Matter Management repositories | Licence boundary; reimplement, do not import |
| `legal-matter-management-infrastructure/environments/prod` | Second production / second ISMS |
| Production `MATTERS_ENABLED=true` | Operator only, Gate A (F2-O1) |
| Root `LICENSE` | Fork rule 4 |
| Rename `mike_workflows`, `mikeApi.ts`, `MIKE_WORKFLOWS_*` | Fork rule 2 |
| Add Redis, a third Express, Grails/Tomcat, Vercel, OpenSearch | Architecture |
| A migrator from `lmm-dev` | D8 |
| Split F2-1 across PRs | SRA 6.3 leak |
| Apply a matters migration during Stage 5 freeze/copy | D5 cutover |
| Edit a [contended file](#contended-file-registry) not owned by this lane **right now** | Merge conflicts and access bugs |

---

## Contended file registry

Exactly one in-flight PR may edit each path. **Owner** is the only
lane allowed to have an unmerged PR that touches it. When that PR
merges, ownership moves to the next row in the queue (or becomes
free).

| Path | Queue (only one live) | Never |
| --- | --- | --- |
| `backend/src/lib/access.ts` | **C** for F2-1 only. After F2-1: **no one** unless a later task is explicitly reassigned | A, B, D, E, F, G* |
| `backend/src/lib/orgs.ts` | **C** for F2-1 (`listOrgResources`) | everyone else |
| `backend/src/lib/userDataCleanup.ts` | **C** for F2-1 | everyone else |
| `backend/schema.sql` | **B** F1-3 (org flag columns only) → **C** F2-1 (matters, `projects.matter_id`, RPCs, `audit_events.matter_id`) → **E** F4-1 → then **one of** G6 / G7 / G9-2, never two | A, D, F, G5, G8 |
| `backend/migrations/YYYYMMDD_NN_*.sql` | Same queue as `schema.sql`. Claim `NN` in the PR title after `ls backend/migrations/` on current `main` | two agents, same date+NN |
| `backend/src/app.ts` | **C** F2-2 (`/matters` mount) → **E** F4-2 → **G7** F7-1 → **G8** F8-1 → **G9** F9-2. One-line `app.use` only | A, B, D, F, G5, G6 |
| `frontend/src/app/components/shared/AppSidebar.tsx` | **D** F2-3 (one nav item, behind env flag) | everyone else |
| `backend/src/lib/chat/tools/toolDispatcher.ts` | **G8** F8-1 (one call to a new module) | everyone else, including C |
| `backend/src/middleware/auth.ts` | **F** F3-1 | everyone else |
| `backend/Dockerfile` | **A** F1-2 | everyone else |
| `frontend/src/app/lib/mikeApi.ts` | **nobody by default.** D may add **one** call to `matterApi.ts` if there is no other hook; prefer zero edits | rewrite, rename, new endpoints |
| `frontend/src/app/lib/env.ts` | **B** F1-3 (`MATTERS_ENABLED` public read if needed) | C–G unless B has merged |
| `infra/modules/gotrue/**` | **F** F3-4 | everyone else |
| `AGENTS.md` | **prefix** F0-2 only, before lanes start | fold-in feature PRs |
| `docs/delivery-plan/v2/architecture.md` | **prefix** F0-1 only | fold-in feature PRs |

`orgPolicy.ts` is a **new** file: B creates it; later F and C **import**
it and must not rewrite it unless B has finished.

---

## Prefix (no parallel fold-in PRs)

Do these as **one agent, in order**, before any lane below starts:

| Order | ID | Lane |
| --- | --- | --- |
| 1 | F0-1 | prefix |
| 2 | F0-2 | prefix |
| 3 | F0-3 | prefix (upstream sync) |

F0-4 (SoA) may start after F0-1 in **parallel with F0-2/F0-3** because
it only creates `docs/isms/**`. It must not edit `AGENTS.md` or
`schema.sql`.

After **F0-3 is on `main`**, assign lanes.

---

## Lane cards

### Lane A — Control plane (ops-adjacent)

| | |
| --- | --- |
| **Tasks, in order** | F1-2, F1-6, F1-5. Pair with OPS on F1-1. **Not** F1-3. |
| **May edit** | `backend/Dockerfile`; existing smoke scripts; `backend/src/middleware/requestLog.ts` and its tests; `docs/runbooks/**` (incident / restore / cutover notes); Stage 5 tickets 2110–2126 as already scoped |
| **May create** | smoke helpers; incident runbook pages under `docs/runbooks/` |
| **Must not edit** | `access.ts`, `orgs.ts`, `schema.sql`, `app.ts`, `AppSidebar.tsx`, `toolDispatcher.ts`, `auth.ts`, `mikeApi.ts`, any `lib/matters/**`, any `frontend/src/app/(pages)/organizations/**` |
| **Stop if** | you think you need a database column |

### Lane B — Policy and evidence

| | |
| --- | --- |
| **Tasks, in order** | F0-4, F1-3, F1-4. Support OPS on F1-O3. |
| **May edit** | `frontend/src/app/lib/env.ts`; `docs/isms/**`; existing `/legal` index only to add links |
| **May create** | `backend/src/lib/orgPolicy.ts`; **one** migration for **org flag columns only** (`mfa_enforced`, `allow_unvetted_model_destinations`, provider residency, freeze stub) plus matching lines in `schema.sql`; `frontend/src/app/legal/**` trust-centre pages |
| **Must not edit** | `access.ts`, `orgs.ts`, `app.ts`, `AppSidebar.tsx`, `toolDispatcher.ts`, `auth.ts`, `Dockerfile`, `mikeApi.ts`, `matters` tables, `projects.matter_id`, SQL `*_access_role` functions |
| **Stop if** | F2-1 is unmerged and you still have `schema.sql` dirty — finish F1-3 and merge before Lane C starts F2-1 |
| **Handoff** | F1-3 must merge before F2-1. Org flag columns are B's; matter tables are C's |

### Lane C — Matter access (confidentiality)

| | |
| --- | --- |
| **Tasks, in order** | **F2-1 (entire, unsplittable)**, then F2-2, then F2-4 |
| **May edit** | `backend/src/lib/access.ts`; `backend/src/lib/orgs.ts`; `backend/src/lib/userDataCleanup.ts`; `backend/schema.sql` (after F1-3 merged); `backend/src/app.ts` **only in F2-2**, one `app.use("/matters", …)` |
| **May create** | `backend/src/lib/matters/matterAccess.ts`; `backend/src/routes/matters.ts`; `backend/src/__tests__/**/matters*.ts`; matters migration (`matters`, `matter_members`, `projects.matter_id`, `audit_events.matter_id`, RPC bodies, `service_role_all`); `docs/data-retention.md` updates (F2-4) |
| **Must not edit** | `Dockerfile`, `toolDispatcher.ts`, `AppSidebar.tsx`, `auth.ts`, `infra/modules/gotrue`, `mikeApi.ts`, frontend pages (that's D), workstream/task tables (that's E) |
| **Stop if** | F1-3 is not on `main`; or another agent has an open PR on `schema.sql` / `access.ts` |
| **Do not split F2-1.** TypeScript hook and SQL list paths are the same PR. |

### Lane D — Matter UI

| | |
| --- | --- |
| **Tasks** | F2-3 only, **after F2-2 is on `main`** (stubs against the API contract may be developed on a branch earlier; do not merge first) |
| **May edit** | `frontend/src/app/components/shared/AppSidebar.tsx` (single Matters item, rendered only when `MATTERS_ENABLED`) |
| **May create** | `frontend/src/app/(pages)/organizations/[id]/matters/**`; `frontend/src/app/components/matters/**` except TaskMap/Roadmap (G5); `frontend/src/app/lib/matterApi.ts`; colocated Vitest |
| **Must not edit** | `access.ts`, `schema.sql`, `app.ts`, `orgs.ts`, `Dockerfile`, `toolDispatcher.ts`, `auth.ts`, `backend/src/routes/**`, `mikeApi.ts` except one optional call |
| **Stop if** | you need a new column or a new HTTP route — that is C or E |

### Lane E — Spine (workstreams / tasks / posts)

| | |
| --- | --- |
| **Tasks, in order** | F4-1, F4-2, F4-3, F4-4. **Not before F2-1 is on `main`.** Not while C still has `schema.sql` or `app.ts` open. |
| **May edit** | `backend/schema.sql` (workstream/task/post objects only, next `NN`); `backend/src/app.ts` **only in F4-2**, mounts for workstream/task/post routers |
| **May create** | `backend/src/lib/matters/workstreams.ts`, `tasks.ts`, `posts.ts`; `backend/src/routes/matterWorkstreams.ts`, `matterTasks.ts` (posts routes as designed in F4-2/F4-4); `frontend/src/app/components/matters/TaskList.tsx` and list/detail pages; F4 tests including copy/move `*.crossMatter.test.ts` |
| **Must not edit** | `access.ts` (import `matterAccess` only), `orgs.ts`, `userDataCleanup.ts`, `AppSidebar.tsx`, `toolDispatcher.ts`, `auth.ts`, `Dockerfile`, `mikeApi.ts`, `orgPolicy.ts`, costs, templates, D3 map |
| **Stop if** | F2-1 is not merged, or C's F2-2 `app.ts` PR is still open |

### Lane F — Firm identity

| | |
| --- | --- |
| **Tasks, in order** | F3-1, F3-2, F3-3; F3-4 only when a named firm needs SSO (D6) |
| **May edit** | `backend/src/middleware/auth.ts`; `infra/modules/gotrue/**` (F3-4); import `orgPolicy.ts` (do not rewrite) |
| **May create** | login UI pieces for Azure; tests for MFA fail-closed on matter routes; session-revoke helper next to existing GoTrue admin usage |
| **Must not edit** | `access.ts`, `schema.sql`, `app.ts`, `AppSidebar.tsx`, `toolDispatcher.ts`, `Dockerfile`, `orgs.ts`, matter UI, matter routes |
| **Stop if** | you need `matter_members` shape changes — that's C |
| **Merge after** | F2-2 (matter routes exist to fail closed on) |

### Lane G5 — Taskmap / roadmap / labels

| | |
| --- | --- |
| **Tasks** | F5-1, F5-2, F5-3 after F4-2 and F4-3 |
| **May create** | `matter_labels` migration **only if no other schema PR is open**; `components/matters/TaskMap.tsx`, `Roadmap.tsx`; label UI |
| **Must not edit** | `access.ts`, `app.ts`, `AppSidebar.tsx`, `toolDispatcher.ts`, `auth.ts`, TaskList (E owns the a11y list — you must keep it reachable, not replace it) |
| **Exclusive vs** | G6, G7, G9 if you need `schema.sql` |

### Lane G6 — Templates

| | |
| --- | --- |
| **Tasks** | F6-1, F6-2 after F4-2 |
| **May create** | template tables + copy-into-matter lib + UI under `components/matters/` template files |
| **Must not edit** | `access.ts`, `AppSidebar.tsx`, `toolDispatcher.ts`, `mike_workflows` tables, `auth.ts` |
| **Exclusive vs** | anyone else on `schema.sql` / `app.ts` |

### Lane G7 — Notifications / history / export

| | |
| --- | --- |
| **Tasks** | F7-1, F7-2, F7-3 after F4-2 |
| **May edit** | `backend/src/app.ts` only when C and E's mounts are merged, one-line if a new router; `backend/src/lib/dbq/handlers.ts` additive job kinds |
| **May create** | notify/export `db_jobs` kinds; inbox UI; export job |
| **Must not edit** | `access.ts`, `AppSidebar.tsx`, `toolDispatcher.ts`, put post bodies in SES |
| **Exclusive vs** | other `app.ts` owners |

### Lane G8 — Matter-aware AI

| | |
| --- | --- |
| **Tasks** | F8-1, F8-2 after Gate A (operator) or Gate B (firm), DPIA for customers |
| **May edit** | `toolDispatcher.ts` **once**, call a new module |
| **May create** | `backend/src/lib/matters/tools.ts` (or similar new file); pre-send notice UI |
| **Must not edit** | `access.ts` internals (call `matterAccess`), `schema.sql`, `AppSidebar.tsx`, `Dockerfile` |
| **Do not start** | while C or E has an open inherited-file PR; not in the same slice as Wave 2 |

### Lane G9 — Costs

| | |
| --- | --- |
| **Tasks, in order** | F9-1 (pure functions, **no schema**) any time after F4-1 exists as spec; F9-2 / F9-3 after F9-1 and F2-2, and after Wave 8 (D7) for product launch |
| **May create** | `backend/src/lib/matters/costs/**` and tests (F9-1); later costs migration/routes/UI |
| **Must not edit** | `access.ts`, `AppSidebar.tsx`, `toolDispatcher.ts`, `mikeApi.ts` |
| **F9-1 is schema-free** | it can run in Set 3 without owning `schema.sql` |
| **F9-2 exclusive vs** | anyone else on `schema.sql` / `app.ts` |

### Lane OPS — Operator (not a software agent)

| | |
| --- | --- |
| **Tasks** | F0-O1, F1-O1, F1-O2, F1-O3, F2-O1, F3-O1, F8-O1 |
| **May** | Stage 5 Task 1/2 answers; dump credentials; Gate A/B/C checklists; production `MATTERS_ENABLED`; Art. 28 / DPIA |
| **Must not** | apply LMM prod; ask an agent to set the flag early; merge F2-1 split |

---

## Legal concurrent combinations

These are the only combinations that do not share a contended file.
Anything not listed needs an explicit exception in the assigning
message.

**Set 1** — F0-3 on `main`, F2-1 not started:

| Running | Idle |
| --- | --- |
| A: F1-2 or F1-6 | C, D, E, F, G* |
| B: F1-3 (has `schema.sql`) **or** F0-4 / F1-4 if F1-3 already merged | C (cannot start F2-1 until F1-3 merged) |
| OPS: F1-O1, F1-O2 | |

**Set 2** — F2-1 in flight:

| Running | Forbidden |
| --- | --- |
| C: F2-1 only | A/B/D/E/F/G* editing `access.ts`, `orgs.ts`, `schema.sql`, `userDataCleanup.ts` |
| A: F1-5 / F1-6 if unused | |
| B: F1-4 / F0-4 if F1-3 already merged | B must not still hold `schema.sql` |
| OPS: Stage 5 prep | freeze/copy: still no matters migration apply |

**Set 3** — F2-1 on `main`, `MATTERS_ENABLED` still false:

| Running | Condition |
| --- | --- |
| C: F2-2 (`app.ts`) | E/G7/G8/G9 must not edit `app.ts` until C's F2-2 merges |
| D: F2-3 branch OK; merge after F2-2 | |
| E: F4-1 (`schema.sql` next `NN`) | only after C's F2-1 merged; **not** while C still has F2-2 if E also needs `app.ts` — E's F4-1 is schema-only-plus-tests, F4-2 waits for F2-2 `app.ts` |
| F: F3-1 after F2-2 | `auth.ts` only |
| G9: F9-1 only (no schema) | |
| A / OPS: F1-1 cutover | no matters migration during freeze |

**Set 4** — F4-2 on `main`:

Run **at most one** of G5-schema, G6, G7, G9-2 at a time if they need
`schema.sql` or `app.ts`. G5 UI (TaskMap) + G9-1 costs math may run
together if neither takes `schema.sql`. G8 only when `toolDispatcher.ts`
is free.

---

## Assignment checklist (human)

Before launching an agent:

1. F0-3 is on `main` (unless the task **is** F0-1/F0-2/F0-3/F0-4).
2. The task's **Depends** in the tasks file are merged.
3. No open PR already owns that task's contended files (registry
   above).
4. Brief contains LANE, TASK, MAY EDIT, MUST NOT EDIT.
5. Migration `NN` claimed in the PR title if the lane creates one.
6. Ceiling: **four software agents + OPS** until F2-1 merges; **four
   to six** after. A fifth software agent in Set 2 is a mistake.

If unsure whether a path is allowed: **it is not.** Ask for a lane
change rather than widening the diff.
