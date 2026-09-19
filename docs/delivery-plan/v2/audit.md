# Audit: where the three components actually stand

Written 10 September 2026, against `main`. Every claim here was checked
against the tree, not recalled. Where something is inferred rather than
verified, it says so.

## Why this audit exists

The original delivery plan (`docs/delivery-plan/backlog.csv`, 107 rows) was
written before the extraction had been done. It has no status column, so
"what is left" cannot be read from it — only reconstructed. It also encodes
an assumption that is no longer true: that this repository's Next.js frontend
might be retired in favour of Juralio (tickets 2053 and 2054). That decision
has now been taken the other way.

## Headline: the three components are not equally far along

| Component | State | Blocking gap |
| --- | --- | --- |
| **Backend** | Substantially complete and hardened | No deployment target exists |
| **Frontend** | Feature-complete, builds, 988 tests pass | Cannot build without the backend source tree |
| **Infrastructure** | **Does not exist** beyond local Docker Compose | Everything |

The backend has had the most attention: tenancy tests, a service-role audit
gate, structured logging with redaction, a schema-privileges gate, and two
storage-deletion bugs fixed. The frontend has had a debrand and little else.
Infrastructure has had nothing — there is no IaC, no cloud account wiring, no
deployment pipeline, and no environment separation.

## Finding 1 — the frontend cannot be built independently

`frontend/Dockerfile` copies `backend/src` into the image, and its comment
explains why: the frontend type-imports from the backend.

The comment overstates the problem. The real coupling is **two import
statements in one file**:

```
frontend/src/app/components/shared/types.ts
  import type { SourceDocument, SourceDocumentAction, SourceDocumentMetadata,
                SourceDocumentQuote, SourceDocumentType, SourceSubdocument }
    from "../../../../../backend/src/lib/sourceDocuments";
  import type { AskInputItem, AskInputResponseItem, AskInputsEvent }
    from "../../../../../backend/src/lib/chat/types";
```

Nine symbols, both `import type`. Five other frontend files mention
`backend/src` only in comments — they are deliberate "mirror of the backend"
notes, not coupling.

This matters more than its size suggests. It means the frontend cannot be
deployed by any pipeline that checks out the frontend alone; the build context
must be the repository root. It is also precisely the pattern that AGENTS.md
fork rule 1 forbids across the Juralio boundary, applied here to the internal
one: *"Re-declare shared types on each side rather than importing them; a
duplicated interface is the cost of the boundary, not a smell."*

**Severing it is nine type declarations.** It is the first thing Stage 1 does.

## Finding 2 — the frontend has no environment of its own

There is no `frontend/.env.example`. The frontend reads only four variables:

| Variable | Used for |
| --- | --- |
| `NODE_ENV` | standard |
| `NEXT_PUBLIC_APP_URL` | absolute URLs in metadata |
| `NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED` | feature flag |
| `API_BASE_URL` | server-side calls to the backend |

Everything else it needs arrives at runtime from the backend. The root
`.env.example` mixes frontend, backend and Docker Compose concerns into one
file, which is why the separation has never been drawn.

`frontend/src/app/lib/mikeApi.ts` hard-codes `API_BASE = "/api"` — a
same-origin path. Something must therefore terminate both the frontend and
`/api` on one origin. Locally that is nginx (`supabase/gateway.conf`). In
production it must be the load balancer or CDN. **This is an infrastructure
requirement that the code silently imposes**, and it is not written down
anywhere.

## Finding 3 — Supabase is load-bearing and cannot be swapped for RDS

This corrects an option I put in front of you: the AWS choice was presented
with "RDS/Aurora → Postgres", and that is not reachable without a rewrite.

- **43 foreign keys** in `backend/schema.sql` reference `auth.users` — the
  Supabase auth schema.
- Supabase Auth (GoTrue) provides authentication, Google OAuth and MFA:
  `auth.getUser`, `auth.signInWithPassword`, `auth.signInWithOAuth`,
  `auth.mfa.listFactors`, `auth.mfa.getAuthenticatorAssuranceLevel`.
- **65 backend files** use the Supabase client.

Moving to bare RDS means rewriting authentication, OAuth, MFA enrolment and
verification, session handling, and migrating 43 FK relationships — while
discarding the deny-all RLS posture the service depends on. That is months of
work on the most security-critical code in the system, and it is not an
infrastructure task.

**The architecture therefore keeps Supabase as managed Postgres + Auth**, and
uses AWS for compute, storage, CDN, DNS and secrets. See `architecture.md`.

## Finding 4 — the backend cannot run serverless

`backend/Dockerfile` installs LibreOffice (`apt-get install libreoffice`) for
document conversion. That is a large, stateful, long-running dependency. It
rules out Lambda and any request-scoped runtime, and sets a real floor on
container memory. ECS Fargate with a persistent task is the right shape.

Redis is **optional**: `QUEUE_DRIVER` accepts `postgres`, so the queue can run
on the database at first and Redis can be added when volume justifies it. One
fewer service to provision and pay for.

## Finding 5 — what the backlog says is left, corrected

> Closed since this was written. Status now lives in
> [`status.csv`](status.csv) and is presented in
> [`delivery-status.xlsx`](delivery-status.xlsx). The counts below are the
> position on the audit date and are kept as the record of it.

The CSV has 13 epics and **94 deliverable tickets**. There is no status field,
so completion was reconstructed from merged pull requests and from direct
checks against the tree.

| | Count |
| --- | --- |
| Deliverable tickets | 94 |
| Completed and named in merged PRs | 15 |
| Completed earlier, verified against the tree | 14 |
| **Genuinely remaining** | **~65** |

The 14 verified-complete are 2002, 2003, 2004 (private repo, history,
`upstream-main`), 2006, 2034, 2035 (fork rules and the do-not-rename table),
2008 (`docs/upstream-sync.md`), 2019 (`scorecard.yml` deleted), 2021, 2022
(Dependabot, CodeQL), 2026 (Stryker), and 2028–2031 (web app debranding —
verified by rendering the pages).

Two corrections to the backlog itself:

- **2012 is not done.** `backend/src/lib/spreadsheet.ts` still has
  `import * as XLSX from "xlsx"`. The dependency was swapped to the maintained
  `@e965/xlsx` fork, which addresses the advisory, but the ticket asks for
  exceljs — which the *frontend* already uses. The backend is the odd one out.
- **2023 is obsolete, not outstanding.** "Disable the Word add-in workflow
  while the add-in is deferred" — the add-in is not deferred; it was debranded
  and is built and tested in CI.

## Finding 6 — the plan's frontend assumption is now wrong

Tickets 2053 ("Decide the disposition of the inherited frontend") and 2054
("Deploy as an internal admin surface, or retire it") assume Juralio becomes
the product frontend. **That decision has been taken the other way**:
legalworkflows ships as a standalone product with this UI.

Consequences:

- 2053 and 2054 close as *decided: keep and complete*.
- The Juralio HTTP seam (2066–2069) is cancelled (architecture decision 7).
  Ticket 2070 (boundary CI) stays. The API is still treated as a contract.
- The frontend acquires a production quality bar it did not have before:
  its own environment, its own build, its own deploy, and its own CI gate.

## What is genuinely good already

Worth stating, because the plan below spends its time on gaps:

- **Tenancy is tested, not assumed.** Cross-tenant denial tests cover every
  router; `npm run tenancy` fails the build on a handler that queries the
  database without using the caller's identity.
- **The licence position is sound.** AGPL notices, the modification date, the
  Corresponding Source offer, and third-party notices are all in place, and
  `npm run trademarks` stops the upstream name reaching a user-visible surface.
- **CI is substantial**: 15 checks, including a repository-boundary gate, a
  schema-drift check that builds both installation paths, gitleaks over full
  history, and a coverage ratchet.
- **The database posture is now uniform**: 51/51 tables revoked from `anon`
  and `authenticated`, enforced by `npm run schema-privileges`.

The gap is not code quality. It is that none of it is deployed.
