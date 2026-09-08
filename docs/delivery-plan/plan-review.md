# Delivery plan review

A review of `legalworkflowservicedeliveryplan.xlsx` against the actual tree at
`8b3466fc04bf8cad623238a71fca1fda3fc89fde`. Everything below was checked by
running commands against this repository, not by reading its CI configuration.

The plan is sound. Its architecture calls are right, its risk register is
honest, and its sprint shaping is deliberate rather than optimistic. What
follows is one blocking finding, a set of factual corrections, and four
judgement calls I would change. None of it moves a phase boundary.

## What the plan gets right, and should not be traded away

- **The service boundary is a licensing boundary.** AGPL-3.0 section 5(c)
  applies its terms to a combined work as a whole, and the combination cannot
  be undone. One stray import relicenses Juralio's entire tree. Treating HTTP
  as the only channel, and enforcing it in CI, is the correct call.
- **Not renaming database objects, environment variables, or the API client.**
  Over 300 files mention the upstream name; a few dozen are user-visible. A
  find-and-replace here buys nothing a user can see and guarantees a conflict
  on every upstream merge.
- **Keeping `Stack tests` as a required check.** The backend runs as the
  Supabase service role against a deny-all RLS posture with zero policies.
  There is no database backstop. That workflow is the only thing standing
  between a route that forgets its access check and a cross-tenant disclosure.
- **Not squashing history.** It is what makes upstream merges possible and it
  is the cleanest evidence of what changed and when, which AGPL section 5(a)
  asks you to state.
- **Deleting `scorecard.yml`.** Confirmed: it sets `publish_results: true`
  against the OpenSSF API, which accepts public repositories only.
- **Sprints 1–2 deliberately light** at 26 and 32 points against a 41-point
  average. That is where the external blockers sit, and the plan says so.

## Blocking finding: ticket 2012 cannot meet its acceptance criteria

Ticket 2012 replaces `xlsx` with `exceljs` in
`backend/src/lib/spreadsheet.ts`, with the acceptance criterion that *"a sample
.xlsx, .xlsm and legacy .xls each produce identical output to the previous
implementation."*

**ExcelJS cannot read legacy `.xls`.** It reads XLSX and CSV; the BIFF binary
format has no support in it. SheetJS reads all three, which is exactly why the
current code uses it — `spreadsheet.ts:7` says so in its own header comment.

And `.xls` is not incidental here. It is a first-class document type across the
backend:

- `backend/src/lib/documentTypes.ts` lists `xls` in the supported set and maps
  it to `application/vnd.ms-excel`.
- `backend/src/lib/sourceDocuments.ts:253` routes `xlsx`/`xlsm`/`xls` to the
  spreadsheet reader.
- `backend/src/lib/chat/tools/documentOps.ts:1654` and
  `backend/src/lib/tabular/tabular.extract.ts:241` both note that SheetJS reads
  `.xls` directly, "no PDF detour".
- `documentTypes.test.ts` asserts `xls` is recognised and that it is *not*
  converted to PDF.

So the swap as written silently drops a supported format, and the tests that
would have caught it are in the 31 backend files that cannot currently run.

Four ways forward, best first:

1. **Host the patched tarball yourself.** Publish `xlsx@0.20.3` to GitHub
   Packages or vendor it, and install from there. `npm ci` stops reaching a
   vendor CDN, behaviour is bit-identical, and you keep the patched version.
   This is the cheapest fix and the plan does not consider it. Roughly 3 points,
   not 8.
2. **`exceljs` for `.xlsx`/`.xlsm`, LibreOffice for `.xls`.** LibreOffice is
   already going onto the backend image in Sprint 3 (ticket 2049); convert
   `.xls` to `.xlsx` on ingest and read it with ExcelJS. Clean, but it adds a
   subprocess to a read path and the output will not be byte-identical.
3. **Pin `xlsx@0.18.5` from the npm registry.** One line, unblocks `npm ci`
   today, keeps `.xls`. But 0.18.5 carries known advisories (prototype
   pollution, ReDoS) — which is precisely why upstream moved to the 0.20.3
   CDN tarball. For a product handling privileged legal material this is the
   wrong trade.
4. **Drop `.xls` support** as a product decision, and remove it from
   `documentTypes.ts` and its tests. Legitimate, but it is a scope change that
   belongs to the product owner, not to a dependency ticket.

Whichever is chosen, rewrite 2012's acceptance criteria to name the decision.
As written it will be marked done while `.xls` is broken.

**Reproduced:** `npm ci` in `backend/` fails here with
`npm error code E403 … 403 Forbidden - GET https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
The plan's headline blocker is real.

## Factual corrections

| Where | Plan says | Actually |
| --- | --- | --- |
| 2003 | `upstream = Open-Legal-Products/legalworkflows` | That repository does not exist. Upstream is `open-legal-products/mike`; `legalworkflows` is the fork's own name. Corrected in the applied setup. |
| 2003 (AC) | `git log --oneline \| wc -l` returns 581 | Returns **631**. The acceptance criterion fails as written. |
| 2015 | "the catalogue repo … may not be AGPL" | `open-legal-products/mike-workflows` is **MIT**. Forking and repointing it carries no copyleft consequence. Question closed. |
| 2035 | `mike_workflows` "and their 11 indexes" | Three explicit indexes on `mike_workflows` at this commit. More importantly the plan omits the `revoke`/`grant` statements in `backend/schema.sql` that keep those tables off `anon` and `authenticated` — a rename would have to update those too, and they are load-bearing for the RLS posture. |
| 2035 | `mikeApi.ts`, 2,837 lines | 2,837 lines confirmed, but the path is `frontend/src/app/lib/mikeApi.ts`, and there is a **second** one at `word-addin/src/taskpane/api/mikeApi.ts`. |
| 2035 | Three `MIKE_WORKFLOWS_*` variables | **Four**: `_REPOSITORY`, `_REF`, `_TOKEN`, and `_GITHUB_TOKEN`. |
| 2027 | "About 260 files mention the name" | **332**, case-insensitively. The conclusion is unchanged: only a few dozen are user-visible. |
| 2008 | "package-lock.json is merged as binary" | Correct, and there are **four** lockfiles under that rule — repo root, `backend/`, `frontend/`, `word-addin/`. `security.yml` audits exactly those four, so a missed regeneration surfaces as a red check. |

## Judgement calls I would change

**2023 — do not disable `word-addin.yml`.** The plan calls it noise. It is
path-filtered to `word-addin/**` and its own workflow file, and its Playwright
suite is fully hermetic — no Supabase, no API, no secrets. It costs nothing on
any pull request that does not touch the add-in. Meanwhile ticket 2033, in the
same sprint, *changes add-in files*: disabling the workflow removes the only
check on the very work that sprint does. Keep it, and drop the ticket. Saves a
point and removes a risk.

**2020 — `ANTHROPIC_API_KEY` is not required for a green e2e run.** The plan
treats it as a prerequisite. `e2e.yml`'s own header states the suite is green
with no secret: 27 of the 31 specs run and the 4 LLM-dependent ones self-skip
via `e2e/llm.ts`. The secret is needed only to *enforce* those 4. The ticket's
5 points are fair for proving the workflow end to end; the secret is a choice,
not a blocker, and framing it as one invents an external dependency in the
sprint that can least afford another.

**2005 and 2025 belong in the same sprint.** Ticket 2005 (Sprint 1) has the
acceptance criterion *"a PR with red CI cannot merge"* — which is only true
once the required checks from ticket 2025 (Sprint 2) are configured. Configure
protection once, in Sprint 1, with the checks named.
`scripts/configure-repo.sh` does both in one run.

**2009 cannot pass before 2012.** The dry-run upstream merge has the acceptance
criterion *"full backend and frontend suites green afterwards"*. The backend
suite cannot run until the install is fixed. Sequence 2009 after 2012–2013, or
relax its criterion to the frontend suite and a clean merge.

## Two things to add to the risk register

**17 — the fork and the private repo have different owners.** The fork belongs
to the user account `matchamfraser`; the private repository belongs to the
**organisation** `Fraser-Matcham`. That means two permission models, two
billing surfaces, and — directly relevant to ticket 2022 — a CodeQL entitlement
that depends on the *organisation's* plan, not the user's. Actions minutes for
the e2e and stack-test suites bill to the organisation. Confirm both before
Sprint 2, not during it.

**18 — `security.yml` will block every pull request the day it becomes
required.** GitHub reports 12 open advisories on the seeded tree (2 high, 9
moderate, 1 low), and that workflow fails the build on high or critical.
Ticket 2025 correctly leaves it out of the required set; this is a note so
that nobody adds it "for completeness" and stops the sprint. Clear the
advisories first, then require it.

## Structure and sizing

Verified against the sheet: 13 epics, 27 stories, 67 sub-tasks, 246 points, no
double counting — estimates sit on sub-tasks only.

| Sprint | Sub-tasks | Points |
| --- | --- | --- |
| 1 | 10 | 26 |
| 2 | 14 | 32 |
| 3 | 11 | 42 |
| 4 | 10 | 53 |
| 5 | 13 | 53 |
| 6 | 9 | 40 |

Sprints 4 and 5 at 53 points are 29% above the 41-point average the plan sets
for itself, and Sprint 4 is also the one carrying the external dependency on
Juralio's API being live. If anything slips, it slips there. The plan's own
instruction — re-baseline after Sprint 1 on actual throughput — is the right
response; hold to it rather than defending the sprint boundaries.
