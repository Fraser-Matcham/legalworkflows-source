# Delivery plan

Taking this AGPL-3.0 fork into a private, production-ready service that the
Juralio matter-management platform consumes over HTTP.

- [`backlog.csv`](backlog.csv) — the full backlog, Jira-importable.
- [`v2/outstanding.md`](v2/outstanding.md) — what is not done, with the
  evidence for each, and what it is blocked on.
- [`plan-review.md`](plan-review.md) — findings from reviewing the plan against
  the actual tree. **Read this before starting Sprint 1**; it contains one
  blocking correction to the highest-priority ticket.
- [`risks.md`](risks.md) — risk and assumption register.
- [`../private-repo-setup.md`](../private-repo-setup.md) — how this repository
  is configured and what still needs an organisation owner.

## Shape

Three phases, 13 epics, 27 stories, 67 sub-tasks, 246 points. Six four-week
sprints, Kanban flow within each. Estimates sit on sub-tasks only — stories
roll up their children and epics carry none — so nothing is counted twice.
Each sub-task is sized to one pull request.

Issue IDs start at 2001 so this backlog can share a Jira project with the
Juralio delivery plan (1001–1160) without collision.

| Sprint | Weeks | Phase | Goal | Sub-tasks | Points |
| --- | --- | --- | --- | --- | --- |
| 1 | 1–4 | Extraction | Private repo live with upstream tracking, build unblocked | 10 | 26 |
| 2 | 5–8 | Extraction | CI made a real gate; upstream brand removed | 14 | 32 |
| 3 | 9–12 | Infrastructure | Supabase, storage, secrets, staging deployment | 11 | 42 |
| 4 | 13–16 | Infrastructure | Security gaps closed; Juralio integration seam live | 10 | 53 |
| 5 | 17–20 | Production ready | Licence compliance, observability, tests over the untested core | 13 | 53 |
| 6 | 21–24 | Production ready | Operational readiness and launch | 9 | 40 |

Velocity assumes one engineer pairing with an agent, ~41 points per sprint.
Sprints 1–2 are light on purpose — that is where the external blockers sit.
Re-baseline after Sprint 1 on actual throughput rather than defending the
boundaries.

## Epics

| ID | Sprint | Epic |
| --- | --- | --- |
| 2001 | 1 | Foundation: private repository and upstream tracking |
| 2010 | 1 | Unblock the build |
| 2017 | 2 | CI/CD adaptation |
| 2027 | 2 | Debranding |
| 2037 | 3 | Infrastructure foundation |
| 2048 | 3 | Deployment pipeline |
| 2055 | 4 | Security remediation |
| 2065 | 4 | Integration with the Juralio platform |
| 2072 | 5 | Licence compliance |
| 2081 | 5 | Observability |
| 2088 | 5 | Backend test safety net |
| 2093 | 6 | Operational readiness |
| 2100 | 6 | Launch |

## Blockers to clear before, or early in, Sprint 1

**~~The build does not install.~~ Fixed.** `backend/package.json` pinned
`xlsx` to a SheetJS CDN tarball rather than a registry package, so `npm ci`
returned 403 behind any egress filter and 31 of the 117 backend test files could
not run. It is now an npm alias to the same version on the public registry. The
fix is not the one ticket 2012 proposes — that one would have dropped legacy
`.xls` support and lost the Excel display-string formatting the reader depends
on. See [`plan-review.md`](plan-review.md) and re-score the ticket.

**The licence enquiry costs a week and can delete an epic.** Approach Open Legal
Products about a commercial licence *before* Sprint 1. If it lands, the entire
Sprint 5 licence-compliance epic (roughly 19 points) disappears. Upstream runs a
required licence/CLA check on pull requests, which is the usual precondition for
dual licensing. Asking early makes the answer cheap either way.

**Your out-of-box content belongs to someone else.** Default workflows are
fetched at runtime from `open-legal-products/mike-workflows`. Fork it and
repoint `MIKE_WORKFLOWS_REPOSITORY` (ticket 2015). That repository is
MIT-licensed, so there is no copyleft consequence to forking it.

**Provision before Sprint 2 ends, or Phase 2 slips.** Supabase projects,
S3-compatible buckets and domains are needed from Sprint 3.

**Sequence against the Juralio plan.** Sprint 4's integration epic needs
Juralio's API deployed and reachable — that is Sprint 4 of 6 in the Juralio
plan. Run the two plans in sequence, or build against a mocked seam.

## Scope decisions already taken

- **Service boundary.** The Mike-derived code stays a separate service; Juralio
  calls it over HTTP. No imports, submodules, shared builds or copied files in
  either direction — a licensing boundary as much as an architectural one.
- **Debranding depth.** User-visible strings and assets only. See the
  do-not-rename table in [`AGENTS.md`](../../AGENTS.md).
- **Upstream tracking retained.** `upstream-main` stays pristine and is merged
  from on a cadence, so upstream security fixes stay cheap to take. This is why
  changes are additive and in new files wherever possible.
- **Word add-in** is carried and rebranded, but not deployed in these 24 weeks.
- **The inherited frontend is retained.** `mikeApi.ts` documents the API
  contract and the Playwright suite drives real flows through it. Recommended
  disposition is an internal operations console, not a customer surface.
- **Backend coverage** is raised on the largest untested files only —
  `tabular.ts`, `user.ts`, `documentOps.ts`, `toolDispatcher.ts` — not toward a
  percentage. The repo's ratchet convention applies: floors only move up.
- **Not included.** Redis (jobs fall back to a Postgres-backed queue
  automatically), a customer-facing UI for this service (Juralio is the UI), and
  any upstream contribution workflow.

## Licence position

The combined deployment is **AGPL-3.0**. Apache-2.0 is one-way compatible with
it: every additional term Apache carries — warranty disclaimer, attribution,
origin marking, publicity limits, trademark reservation, indemnification —
falls inside AGPL section 7's permitted list, so nothing trips section 10's bar
on further restrictions.

The private repository triggers nothing; section 2 permits private modification
indefinitely. **Section 13 is the trigger**: once users interact with the
modified version over a network, you must prominently offer them its
Corresponding Source, from a network server, at no charge.

The dependency tree is clear. Across 1,756 packages in both applications the
licences are overwhelmingly MIT, Apache-2.0, ISC and BSD. The only copyleft is
weak or dual-licensed — elect MIT for `jszip` and Apache for `dompurify`;
`lightningcss` and `axe-core` are build and test tooling; `sharp`'s LGPL is a
dynamically linked native binary. No second copyleft trap.

Practically: you may charge for the service (section 4) but may not restrict
what recipients do with the source (section 10), so any customer may
redistribute it. **Plan as though the source is public.** That is a commercial
fact to price in, not a compliance step.

This is an engineering reading of the licence texts, not legal advice. Have
counsel confirm the position before launch.

## Working a ticket

One branch per sub-task: `feature/<issue-key>-<short-slug>`.

The Summary, Description and Acceptance Criteria in `backlog.csv` are written
to be pasted straight into an agent session as the task brief — each sub-task
description carries the file paths, the specific problem, and the approach.

Definition of done: merged, CI green, acceptance criteria demonstrably met, and
documentation updated where behaviour changed.

Read the fork rules at the top of [`AGENTS.md`](../../AGENTS.md) first. They
override anything in a ticket that conflicts with them.

## Importing into Jira

1. Settings > System > External System Import > CSV. Use
   [`backlog.csv`](backlog.csv) as-is.
2. Map: `Issue Id` > Issue Id, `Parent Id` > Parent Id, `Issue Type` > Issue
   Type, `Summary` > Summary, `Description` > Description, `Story Points` >
   Story Points, `Priority` > Priority, `Labels` > Labels (allows multiple),
   `Component` > Component/s, `Sprint` > Sprint.
3. `Acceptance Criteria` maps to a custom field if you have one; otherwise
   append it to Description before importing.
4. Create the six sprints in the board backlog before importing, so the
   `Sprint` column resolves.
5. Rows are already ordered Epic > Story > Sub-task, so parents exist before
   children.
