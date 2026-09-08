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

## Ticket 2012: the acceptance criteria could not be met as written — resolved

Ticket 2012 replaces `xlsx` with `exceljs` in `backend/src/lib/spreadsheet.ts`,
with the acceptance criterion that *"a sample .xlsx, .xlsm and legacy .xls each
produce identical output to the previous implementation."*

**ExcelJS cannot read legacy `.xls`.** It reads XLSX and CSV; the BIFF binary
format has no support in it. SheetJS reads all three, which is exactly why the
current code uses it — `spreadsheet.ts:7` says so in its own header comment.

And `.xls` is not incidental. It is a first-class document type across the
backend: `documentTypes.ts` lists it and maps it to
`application/vnd.ms-excel`; `sourceDocuments.ts:253` routes `xlsx`/`xlsm`/`xls`
to the spreadsheet reader; `documentOps.ts:1654` and `tabular.extract.ts:241`
both note that SheetJS reads `.xls` directly, "no PDF detour"; and
`documentTypes.test.ts` asserts `xls` is recognised and *not* converted to PDF.

There is a second problem the ticket does not mention, and it is the one that
makes it an 8-point ticket rather than a 2-point one. The reader depends on
`cell.w`, the Excel-*formatted* display string, so that `1200` reaches the model
as `$1,200` and a date serial reaches it as `3/1/26`. **SheetJS computes that
string; ExcelJS does not.** Swapping the library means re-implementing Excel's
number-format rendering, which is where "identical output" would actually have
been lost. The ticket's own note that "exceljs is already a frontend dependency,
so it is a known quantity" is weaker than it reads: the frontend uses ExcelJS
only in `exportToExcel.ts`, as a *writer*. Nothing in this repository reads a
workbook with it. The frontend's spreadsheet *viewer* uses LuckyExcel, which is
also `.xlsx`-only.

### What was done instead

The premise behind the ticket is that `xlsx` must be replaced because it is
pinned to a vendor CDN. It does not have to be. SheetJS 0.20.3 — the exact
version pinned — is on the public npm registry, republished as
`@e965/xlsx`, Apache-2.0. So the dependency is now an npm alias:

```json
"xlsx": "npm:@e965/xlsx@0.20.3"
```

One line. No source changes at all: the import specifier is still `"xlsx"`, so
`spreadsheet.ts` — a file upstream actively maintains — carries no conflict
surface from this change, which is what fork rule 3 asks for. The whole diff is
5 insertions and 4 deletions across `package.json` and `package-lock.json`.

Output is identical to the previous implementation *by construction*, because it
is the same code at the same version, and the lockfile records the integrity
hash. Verified end to end:

- `npm ci` succeeds behind the egress filter that returned 403 before.
- `npm run build` passes.
- `npm test` passes: **117 test files** (111 passed, 6 skipped), 1,422 tests,
  1,383 passed, 39 skipped. The ticket 2013 criterion was "117, not 80".
- Round-tripping a workbook with a currency and a date format through all three
  formats returns the formatted display strings intact:

  | Format | Bytes | `B2` (`"$"#,##0`) | `C2` (`m/d/yy`) |
  | --- | --- | --- | --- |
  | `.xlsx` | 16,251 | `$1,200` | `3/1/26` |
  | `.xlsm` | 16,229 | `$1,200` | `3/1/26` |
  | `.xls` | 4,096 | `$1,200` | `3/1/26` |

- `npm audit` on the backend: 0 high, 0 critical, 4 moderate. `security.yml`
  gates on high and critical, so the backend passes its own audit gate. (The 2
  high advisories GitHub reports are elsewhere in the tree.)

### The trade-off, stated plainly

This swaps a vendor-hosted tarball for a **single-maintainer community
republish**. That is a real supply-chain consideration for a product handling
privileged legal material, and it should be a conscious choice rather than a
convenience.

What was checked before adopting it: the tarball's SHA-512 matches the registry
metadata (`sha512-703RN/3Ods…`) and is pinned in the lockfile; the archive
carries the genuine SheetJS layout and the `xlsx.js (C) 2013-present SheetJS`
header with `XLSX.version = '0.20.3'`; the licence is Apache-2.0; there is **no
`postinstall` script**; and the code contains no `eval`, no `Function()`, no
`child_process`, no `http`/`https`/`fetch`/`XMLHttpRequest`, and no
`process.env` access. `npm audit` reports nothing against it.

The strictly better long-term answer is to **mirror the official 0.20.3 tarball
into GitHub Packages** and depend on that, which removes the third party
entirely. It could not be done from this environment — `cdn.sheetjs.com` is
blocked at the egress proxy, so the original tarball cannot be fetched here. Do
it from a machine with egress when convenient; it is then another one-line
change to the same `"xlsx"` key, with no source impact either.

Two options that were considered and rejected: pinning `xlsx@0.18.5`, the last
version SheetJS published to npm, carries known prototype-pollution and ReDoS
advisories and is exactly what upstream moved away from; and dropping `.xls`
support is a product decision, not a dependency ticket's to take.

**Re-point ticket 2012 at this change and re-score it.** It was 8 points and is
now closer to 2, and the sprint has that capacity back.

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
