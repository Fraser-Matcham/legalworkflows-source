# Private repository setup

The record of how `Fraser-Matcham/legalworkflows` is configured, what has been
applied, and what still needs an organisation owner to press the button.

This covers the Foundation epic of the delivery plan (tickets 2001–2009) and
the parts of the CI epic (2017–2026) that are repository settings rather than
code.

## What this repository is

A private extraction of `open-legal-products/mike` (AGPL-3.0), run as a
standalone HTTP service that the Juralio matter-management platform consumes.
The service boundary is HTTP and nothing else; the reasoning and the four rules
that follow from it are at the top of [`AGENTS.md`](../AGENTS.md).

## Remote topology

| Remote | Points at | Job |
| --- | --- | --- |
| `origin` | `Fraser-Matcham/legalworkflows` (private) | The service. All work lands here. |
| `upstream` | `open-legal-products/mike` (public, AGPL-3.0) | Source of upstream fixes. Read-only. |
| `fork` | `matchamfraser/legalworkflows` (public fork) | Provenance, and the route for any upstream pull request. Not used by the sync routine. |

The delivery plan names the upstream remote `Open-Legal-Products/legalworkflows`.
That repository does not exist — the upstream project is
`open-legal-products/mike`, and `legalworkflows` is the name of the fork. Use
the URL in the table.

## Branches

| Branch | Purpose | Protection |
| --- | --- | --- |
| `main` | The service. | Pull request required; required checks must pass; branches must be up to date; no force push; no deletion. |
| `upstream-main` | A pristine mirror of `upstream/main`. Never committed to. | No force push; no deletion. Fast-forward pushes still succeed, which is exactly what the sync routine needs and what stops the mirror drifting. |

Both were seeded at `8b3466fc04bf8cad623238a71fca1fda3fc89fde`, which was the
head of upstream `main` and of the fork simultaneously —
`git rev-list --left-right --count upstream/main...main` returned `0 0`. The
full history came across: 631 commits, no squash, no re-init.

The plan states 581 commits. The tree at that commit carries 631; the plan's
figure appears to be from a shallow or partial clone. Nothing else in the plan
depends on the number.

## Applied

- Both branches pushed to `origin` with complete history.
- Fork rules written into [`AGENTS.md`](../AGENTS.md) — the HTTP-only service
  boundary, the user-visible-only rename rule with its do-not-rename table, the
  additive-changes rule, and the rule that `LICENSE` is never altered.
- The sync routine documented in [`upstream-sync.md`](upstream-sync.md) and
  scripted in [`scripts/upstream-sync.sh`](../scripts/upstream-sync.sh).
- Dependabot is **already running**, and more of it than the plan assumes.
  Alerts are on — the seeding push reported 12 open advisories (2 high, 9
  moderate, 1 low) — and version updates fired immediately on `.github/dependabot.yml`,
  opening 11 pull requests within minutes of the seed. Ticket 2021's acceptance
  criterion ("Dependabot opens a PR against a seeded outdated dependency") is
  met on arrival; what remains of that ticket is confirming the **security
  updates** toggle, which is separate and which
  [`scripts/configure-repo.sh`](../scripts/configure-repo.sh) sets.

  Two things follow from that queue, and both land in Sprint 1 rather than
  Sprint 2:

  - **None of the 11 can go green until the install is fixed.** Every one of
    them has to pass `CI / Backend build and tests`, and `npm ci` fails on the
    backend today. Ticket 2012 gates the dependency queue as well as the
    build.
  - **Four of them bump GitHub Actions across major versions** —
    `actions/checkout` 4→7, `actions/setup-node` 4→7, and `codeql-action`
    3.37.4→4.37.9 twice. This repository pins actions to 40-character commit
    SHAs on purpose (a tag is mutable, so a compromised action repository can
    silently swap what `v4` points at). Dependabot preserves the SHA pin when
    it bumps, but a major-version jump across four workflows is a review, not
    a rubber stamp. Take the `codeql-action` ones only after ticket 2022
    settles whether CodeQL runs here at all.

## Needs an organisation owner

The GitHub App token available inside an agent session has no admin scope on
this repository, so branch protection cannot be applied from one.
[`scripts/configure-repo.sh`](../scripts/configure-repo.sh) applies everything
below in one idempotent run — read its comments, then:

```sh
gh auth login          # 'repo' and 'admin:org' scopes
./scripts/configure-repo.sh
```

It sets branch protection on `main` and `upstream-main`, the merge settings,
and the two Dependabot toggles. What it cannot set, and you must do by hand,
is listed at the end of its output.

### Required status checks

These are GitHub check *contexts* — `<workflow name> / <job name>`. All of them
run on `pull_request` into `main`, so none can strand a pull request waiting for
a status that never arrives.

- `CI / Backend build and tests`
- `CI / Frontend build and tests`
- `CI / Eval harness`
- `Stack tests / Supabase stack integration tests`
- `Schema drift / Fresh install vs upgraded deployment`
- `Secret scan / gitleaks (full history)`

`Stack tests` is the one to protect hardest. This architecture runs the backend
as the Supabase service role against a deny-all RLS posture with zero policies,
so there is no database backstop if a route forgets its access check. That
workflow boots a real Supabase and asserts the firewall holds for `anon` and
`authenticated` clients. It is the only thing standing between a missing check
and a cross-tenant disclosure.

### Deliberately not required yet

| Check | Why not |
| --- | --- |
| `e2e / playwright` | The strongest gate and the slowest — it boots Supabase, RustFS, the backend and Next.js on the runner. Add it after a sprint of living with the feedback loop. |
| `security / dependency-audit (…)` | Fails on any high or critical advisory. With 2 high advisories open on the inherited tree, requiring it today blocks every pull request on debt that predates you. Clear them first. |
| `CodeQL / Analyze (javascript-typescript)` | Add it once it has been green for a few runs. Code scanning is available here — see below — but give it a settling period before it can block a merge. |
| `Mutation testing`, `Scorecard`, `SSE load test`, `Word add-in` | Not pull-request gates by design — monthly, manual, impossible on a private repo, and path-filtered respectively. |

### Actions secrets

| Secret | Needed for | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | The 4 LLM-dependent e2e specs | **Optional.** `e2e.yml` is green without it: 27 of 31 specs run and the other 4 self-skip via `e2e/llm.ts`. Set it — spend-capped, CI-scoped — only to enforce those 4. The plan treats it as required for a green e2e run; it is not. See [`e2e-ci.md`](e2e-ci.md). |
| `LOADTEST_AUTH_TOKEN` | `loadtest.yml` | Only if the k6 job is kept. `workflow_dispatch` only, so it never gates a merge. |

## CodeQL on a private repository — ticket 2022, answered

The risk register expected code scanning to be unavailable on a private
organisation repository without a paid plan. That is not what happened. CodeQL
runs here; it failed for a different and much cheaper reason.

The first run failed during `init` with:

```
Setting overlay database mode to overlay with caching because we are analyzing a pull request.
Checking cache for overlay-base database
##[error]Resource not accessible by integration - https://docs.github.com/rest/actions/workflow-runs#get-a-workflow-run
```

When analysing a pull request the action uses overlay database mode and looks
up the base database from a previous workflow run — an Actions REST call. The
job granted `contents: read` and `security-events: write` and nothing else. On a
public repository the default token can already read workflow runs, so upstream
never hit this; on a private one it cannot. Adding `actions: read` to the job's
permissions block fixes it, and least privilege still holds — read, not write.

So the answer to ticket 2022 is that the capability is there and the ticket is a
one-line permissions change, not a purchasing decision. Confirm it stays green
over a few runs before making it a required check.

## Known state of the inherited tree

Verified against this repository at the seeded commit, not read from its CI
configuration:

- **`npm ci` in `backend/` — fixed.** It failed with
  `403 Forbidden - GET https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`,
  reproduced here rather than quoted: `backend/package.json` pinned `xlsx` to a
  vendor tarball rather than a registry package. It is now an npm alias to the
  same SheetJS version on the public registry,
  `"xlsx": "npm:@e965/xlsx@0.20.3"` — one line, no source changes, `.xls`
  support and `cell.w` formatting intact. `npm ci`, `npm run build` and
  `npm test` all pass, with all **117** backend test files running rather than
  80. The supply-chain review behind that choice, and the strictly better
  long-term option, are in
  [`delivery-plan/plan-review.md`](delivery-plan/plan-review.md).
- **288 test files**: 117 backend, 141 frontend, the rest in `e2e/` and
  `word-addin/`. The backend suite now runs in full — 1,383 tests passed, 39
  skipped, across 117 files.
- **11 workflows** in `.github/workflows/`. `scorecard.yml` sets
  `publish_results: true` against the OpenSSF API, which only accepts public
  repositories — it cannot work here and should be deleted (ticket 2019).
- **The workflow catalogue is fetched from a third party at runtime.**
  `backend/src/lib/workflowCatalogSource.ts` defaults
  `MIKE_WORKFLOWS_REPOSITORY` to `Open-Legal-Products/mike-workflows`. That
  repository is **MIT-licensed**, not AGPL — which answers the open question in
  ticket 2015 and means forking and repointing it carries no copyleft
  consequence. Do it, or your out-of-box product content stays under someone
  else's control.
- **Lockfiles merge as binary**, deliberately — see `.gitattributes` and the
  conflict convention in [`upstream-sync.md`](upstream-sync.md).

## Licence position

`LICENSE` is AGPL-3.0 and stays exactly as it is. The private repository itself
triggers nothing: section 2 permits private modification indefinitely. Section
13 is the trigger — once users interact with the modified service over a
network, they must be offered its Corresponding Source, from a network server,
at no charge. Plan on the basis that the source is reachable by every customer.

That is a commercial fact to price in, not a compliance step, and it is why the
plan's first recommendation is to ask Open Legal Products about a commercial
licence before Sprint 1 rather than after it.

This is an engineering reading of the licence text. Have counsel confirm it
before launch.
